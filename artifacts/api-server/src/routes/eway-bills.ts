import { Router } from "express";
import { db, ewayBillsTable, usersTable, businessesTable, invoicesTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { requireAuth } from "./auth";

const router = Router();

async function getBusinessId(userId: number): Promise<number | null> {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return user?.businessId ?? null;
}

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

router.get("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });
  const bills = await db.select().from(ewayBillsTable)
    .where(eq(ewayBillsTable.businessId, businessId))
    .orderBy(desc(ewayBillsTable.createdAt));
  return res.json({ bills: bills.map(mapBill) });
});

router.post("/", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  if (!businessId) return res.status(400).json({ error: "No business" });

  const {
    supplyType, subSupplyType, docType, docNo, docDate,
    fromGstin, fromTrdName, fromAddr1, fromCity, fromState, fromPincode,
    toGstin, toTrdName, toAddr1, toCity, toState, toPincode,
    transMode, transDistance, transporterName, transporterId,
    transDocNo, transDocDate, vehicleNo, vehicleType,
    totalValue, cgstValue, sgstValue, igstValue, totalInvValue,
    items = [], invoiceId,
  } = req.body;

  if (!docNo) return res.status(400).json({ error: "docNo required" });
  if (!docDate) return res.status(400).json({ error: "docDate required" });

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
    invoiceId: invoiceId ? parseInt(invoiceId) : null,
    status: "draft",
  }).returning();

  return res.status(201).json({ bill: mapBill(bill) });
});

router.get("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  const [bill] = await db.select().from(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, parseInt(req.params.id)), eq(ewayBillsTable.businessId, businessId!)))
    .limit(1);
  if (!bill) return res.status(404).json({ error: "Not found" });
  return res.json(mapBill(bill));
});

router.patch("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
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
    .where(and(eq(ewayBillsTable.id, parseInt(req.params.id)), eq(ewayBillsTable.businessId, businessId!)))
    .returning();
  if (!bill) return res.status(404).json({ error: "Not found" });
  return res.json(mapBill(bill));
});

router.delete("/:id", requireAuth, async (req: any, res) => {
  const businessId = await getBusinessId(req.userId);
  await db.delete(ewayBillsTable)
    .where(and(eq(ewayBillsTable.id, parseInt(req.params.id)), eq(ewayBillsTable.businessId, businessId!)));
  return res.json({ success: true });
});

export default router;
