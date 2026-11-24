import { Router } from "express";
import { db, ewayBillsTable, businessesTable, invoicesTable } from "@workspace/db";
import { eq, and, desc, count } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { dec, toColumn, toJson } from "../lib/money";
import { validateBody, validateParams, validateQuery } from "../middleware/validate";
import { CreateEwayBillBody, UpdateEwayBillBody, ListEwayBillsQuery, IdParam } from "../schemas";
import type { TenantRequest, IdParams } from "../lib/http";
import { buildEwayBillJson } from "../lib/einvoice";
import { IRP_PATHS, IrpError } from "../lib/irp";
import { callIrp } from "../lib/irp-store";
import { recordAudit, actorFrom } from "../lib/audit";

import { books } from "../middleware/books";

const router = Router();

/**
 * Handlers in this router run after `requireAuth` and `requireBusiness`, so
 * the caller's tenant is resolved and the user row is loaded. Typing them this way is what
 * makes a missing or misspelled `businessId` a compile error rather than
 * `undefined` reaching a query.
 */
type Req = TenantRequest<any, any, IdParams>;


function mapBill(b: any) {
  return {
    ...b,
    totalValue: toJson(b.totalValue ?? "0"),
    cgstValue: toJson(b.cgstValue ?? "0"),
    sgstValue: toJson(b.sgstValue ?? "0"),
    igstValue: toJson(b.igstValue ?? "0"),
    totalInvValue: toJson(b.totalInvValue ?? "0"),
    items: Array.isArray(b.items) ? b.items : [],
  };
}

router.get("/", requireAuth, requireBusiness, validateQuery(ListEwayBillsQuery), async (req: Req, res) => {
  const businessId = req.businessId;
  const { page, limit } = req.validatedQuery;
  // This was the one list endpoint with no page or limit: every bill a tenant
  // had ever created, each carrying up to 500 line records, built in memory and
  // serialised in one response.
  const bills = await db.select().from(ewayBillsTable)
    .where(eq(ewayBillsTable.businessId, businessId))
    .orderBy(desc(ewayBillsTable.createdAt))
    .limit(limit).offset((page - 1) * limit);
  const [{ count: total }] = await db.select({ count: count() }).from(ewayBillsTable)
    .where(eq(ewayBillsTable.businessId, businessId));
  return res.json({ bills: bills.map(mapBill), total: Number(total) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateEwayBillBody), books("eway_bill"), async (req: Req, res) => {
  const businessId = req.businessId;

  const {
    supplyType, subSupplyType, docType, docNo, docDate,
    fromGstin, fromTrdName, fromAddr1, fromCity, fromState, fromPincode,
    toGstin, toTrdName, toAddr1, toCity, toState, toPincode,
    transMode, transDistance, transporterName, transporterId,
    transDocNo, transDocDate, vehicleNo, vehicleType,
    totalValue, cgstValue, sgstValue, igstValue, totalInvValue,
    items = [], invoiceId,
  } = req.body;

  // Same class as the customer/vendor leak: an unscoped id let a bill reference
  // another tenant's invoice. Nothing crossed the boundary yet, but it stored a
  // dangling reference any future join would happily resolve.
  let resolvedInvoiceId: number | null = null;
  if (invoiceId) {
    const [invoice] = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(and(eq(invoicesTable.id, Number(invoiceId)), eq(invoicesTable.businessId, businessId)))
      .limit(1);
    if (!invoice) return res.status(400).json({ error: "Unknown invoice" });
    resolvedInvoiceId = invoice.id;
  }

  const [bill] = await db.insert(ewayBillsTable).values({
    businessId,
    supplyType: supplyType ?? "O",
    subSupplyType: subSupplyType ?? "1",
    docType: docType ?? "INV",
    docNo, docDate,
    fromGstin, fromTrdName, fromAddr1, fromCity, fromState, fromPincode,
    toGstin, toTrdName, toAddr1, toCity, toState, toPincode,
    transMode: transMode ?? "1",
    transDistance: transDistance === undefined || transDistance === null ? null : dec(transDistance).toFixed(2),
    transporterName, transporterId, transDocNo, transDocDate,
    vehicleNo, vehicleType: vehicleType ?? "R",
    totalValue: toColumn(totalValue ?? 0),
    cgstValue: toColumn(cgstValue ?? 0),
    sgstValue: toColumn(sgstValue ?? 0),
    igstValue: toColumn(igstValue ?? 0),
    totalInvValue: toColumn(totalInvValue ?? 0),
    items,
    invoiceId: resolvedInvoiceId,
    status: "draft",
  }).returning();

  return res.status(201).json({ bill: mapBill(bill) });
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const businessId = req.businessId;
  const [bill] = await db.select().from(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, businessId)))
    .limit(1);
  if (!bill) return res.status(404).json({ error: "Not found" });
  return res.json(mapBill(bill));
});

/**
 * GET /eway-bills/:id/json — the bill in the portal's bulk-generation format,
 * for upload at ewaybillgst.gov.in. 400 lists what to fix first.
 */
router.get("/:id/json", requireAuth, requireBusiness, validateParams(IdParam), async (req: Req, res) => {
  const [bill] = await db.select().from(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, req.businessId))).limit(1);
  if (!bill) return res.status(404).json({ error: "Not found" });
  const [invoice] = bill.invoiceId
    ? await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, bill.invoiceId), eq(invoicesTable.businessId, req.businessId))).limit(1)
    : [];
  const out = buildEwayBillJson(mapBill(bill), invoice);
  if (out.problems) return res.status(400).json({ error: `Fix these first: ${out.problems.join(" ")}`, problems: out.problems });
  res.setHeader("Content-Disposition", `attachment; filename="EWB_${bill.docNo.replace(/[^\w-]+/g, "_")}.json"`);
  return res.json(out.json);
});

const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
/** "2026-11-23 10:15:00 AM" or "23/11/2026 10:15:00 AM" from the IRP, as YYYY-MM-DD. */
const isoDay = (v: unknown) => {
  const t = String(v ?? "");
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t) ?? /^(\d{2})\/(\d{2})\/(\d{4})/.exec(t);
  if (!m) return t.slice(0, 40) || null;
  return m[1]!.length === 4 ? `${m[1]}-${m[2]}-${m[3]}` : `${m[3]}-${m[2]}-${m[1]}`;
};

/**
 * POST /eway-bills/:id/generate — get the e-way bill from the e-invoice system,
 * for a bill linked to an invoice that has an IRN.
 */
router.post("/:id/generate", requireAuth, requireBusiness, validateParams(IdParam), books("eway_bill"), async (req: Req, res) => {
  const [bill] = await db.select().from(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, req.businessId))).limit(1);
  if (!bill) return res.status(404).json({ error: "Not found" });
  if (bill.status !== "draft") return res.status(409).json({ error: "This e-way bill is not a draft." });
  const [invoice] = bill.invoiceId
    ? await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, bill.invoiceId), eq(invoicesTable.businessId, req.businessId))).limit(1)
    : [];
  if (!invoice?.irn) {
    return res.status(409).json({ error: "Generating here needs the linked invoice to have an IRN. Generate the IRN first, or download the portal file." });
  }
  const distance = Math.round(Number(bill.transDistance ?? 0));
  if (!(distance > 0 && distance <= 4000)) return res.status(400).json({ error: "Distance must be between 1 and 4000 km." });
  const payload: Record<string, unknown> = {
    Irn: invoice.irn, Distance: distance, TransMode: bill.transMode ?? "1",
    ...(bill.transporterId ? { TransId: bill.transporterId.toUpperCase() } : {}),
    ...(bill.transporterName ? { TransName: bill.transporterName } : {}),
    ...(bill.transDocNo ? { TransDocNo: bill.transDocNo } : {}),
    ...(bill.transDocDate ? { TransDocDt: ddmmyyyy(bill.transDocDate) } : {}),
    ...(bill.vehicleNo ? { VehNo: bill.vehicleNo.replace(/[\s-]/g, "").toUpperCase(), VehType: bill.vehicleType ?? "R" } : {}),
  };
  let r: any;
  try {
    r = await callIrp(req.businessId, IRP_PATHS.ewayByIrn, payload);
  } catch (err) {
    if (err instanceof IrpError) return res.status(err.code === "NO_LOGIN" ? 409 : 502).json({ error: err.message, code: err.code });
    throw err;
  }
  const [row] = await db.update(ewayBillsTable)
    .set({ status: "generated", ewbNo: String(r.EwbNo), ewbDate: isoDay(r.EwbDt), validUpto: isoDay(r.EwbValidTill) })
    .where(and(eq(ewayBillsTable.id, bill.id), eq(ewayBillsTable.businessId, req.businessId))).returning();
  await recordAudit({ ...actorFrom(req), action: "eway_bill.generated", targetType: "eway_bill", targetId: row.id, details: { ewbNo: row.ewbNo } });
  return res.json(mapBill(row));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateEwayBillBody), books("eway_bill"), async (req: Req, res) => {
  const businessId = req.businessId;
  const {
    status, ewbNo, ewbDate, validUpto,
    transMode, transDistance, transporterName, transporterId,
    transDocNo, transDocDate, vehicleNo, vehicleType,
  } = req.body;

  // "Generated" means the portal issued a number. It used to be set here with a
  // number we made up, which printed a bill no checkpost could verify.
  if (status === "generated" && !ewbNo) {
    return res.status(400).json({ error: "Enter the 12-digit e-way bill number the portal gave you." });
  }

  const updates: any = {};
  if (status !== undefined) updates.status = status;
  if (ewbNo !== undefined) updates.ewbNo = ewbNo;
  if (ewbDate !== undefined) updates.ewbDate = ewbDate;
  if (validUpto !== undefined) updates.validUpto = validUpto;
  if (transMode !== undefined) updates.transMode = transMode;
  if (transDistance !== undefined) updates.transDistance = transDistance === null ? null : dec(transDistance).toFixed(2);
  if (transporterName !== undefined) updates.transporterName = transporterName;
  if (transporterId !== undefined) updates.transporterId = transporterId;
  if (transDocNo !== undefined) updates.transDocNo = transDocNo;
  if (transDocDate !== undefined) updates.transDocDate = transDocDate;
  if (vehicleNo !== undefined) updates.vehicleNo = vehicleNo;
  if (vehicleType !== undefined) updates.vehicleType = vehicleType;

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: "Nothing to update" });

  const [bill] = await db.update(ewayBillsTable).set(updates)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, businessId)))
    .returning();
  if (!bill) return res.status(404).json({ error: "Not found" });
  return res.json(mapBill(bill));
});

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), books("eway_bill"), async (req: Req, res) => {
  const businessId = req.businessId;
  await db.delete(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
