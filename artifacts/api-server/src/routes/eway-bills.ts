import { Router } from "express";
import { db, ewayBillsTable, businessesTable, invoicesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody, validateParams } from "../middleware/validate";
import { CreateEwayBillBody, UpdateEwayBillBody, IdParam } from "../schemas";

const router = Router();

function mapBill(b: any) {
  return {
    ...b,
    totalValue: parseFloat(b.totalValue ?? "0"),
    cgstValue: parseFloat(b.cgstValue ?? "0"),
    sgstValue: parseFloat(b.sgstValue ?? "0"),
    igstValue: parseFloat(b.igstValue ?? "0"),
    totalInvValue: parseFloat(b.totalInvValue ?? "0"),
    items: Array.isArray(b.items) ? b.items : [],
  };
}

router.get("/", requireAuth, requireBusiness, async (req: any, res) => {
  const businessId = req.businessId;
  const bills = await db.select().from(ewayBillsTable)
    .where(eq(ewayBillsTable.businessId, businessId))
    .orderBy(desc(ewayBillsTable.createdAt));
  return res.json({ bills: bills.map(mapBill) });
});

router.post("/", requireAuth, requireBusiness, validateBody(CreateEwayBillBody), async (req: any, res) => {
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
    transDistance: transDistance ? String(transDistance) : null,
    transporterName, transporterId, transDocNo, transDocDate,
    vehicleNo, vehicleType: vehicleType ?? "R",
    totalValue: totalValue ? String(totalValue) : "0",
    cgstValue: cgstValue ? String(cgstValue) : "0",
    sgstValue: sgstValue ? String(sgstValue) : "0",
    igstValue: igstValue ? String(igstValue) : "0",
    totalInvValue: totalInvValue ? String(totalInvValue) : "0",
    items,
    invoiceId: resolvedInvoiceId,
    status: "draft",
  }).returning();

  return res.status(201).json({ bill: mapBill(bill) });
});

router.get("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  const [bill] = await db.select().from(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, businessId)))
    .limit(1);
  if (!bill) return res.status(404).json({ error: "Not found" });
  return res.json(mapBill(bill));
});

router.patch("/:id", requireAuth, requireBusiness, validateParams(IdParam), validateBody(UpdateEwayBillBody), async (req: any, res) => {
  const businessId = req.businessId;
  const {
    status, ewbNo, ewbDate, validUpto,
    transMode, transDistance, transporterName, transporterId,
    transDocNo, transDocDate, vehicleNo, vehicleType,
  } = req.body;

  const updates: any = {};
  if (status !== undefined) updates.status = status;
  if (ewbNo !== undefined) updates.ewbNo = ewbNo;
  if (ewbDate !== undefined) updates.ewbDate = ewbDate;
  if (validUpto !== undefined) updates.validUpto = validUpto;
  if (transMode !== undefined) updates.transMode = transMode;
  if (transDistance !== undefined) updates.transDistance = String(transDistance);
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

router.delete("/:id", requireAuth, requireBusiness, validateParams(IdParam), async (req: any, res) => {
  const businessId = req.businessId;
  await db.delete(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, req.validatedParams.id), eq(ewayBillsTable.businessId, businessId)));
  return res.json({ success: true });
});

export default router;
