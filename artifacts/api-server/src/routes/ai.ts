import express, { Router, type IRouter } from "express";
import { z } from "zod";
import { db, invoicesTable, purchasesTable, customersTable, productsTable, paymentsTable, businessesTable } from "@workspace/db";
import { and, eq, gte, lte, desc, ilike, sql, count, sum as sqlSum } from "drizzle-orm";
import { requireAuth, requireBusiness } from "./auth";
import { validateBody } from "../middleware/validate";
import { dec, toJson } from "../lib/money";
import { lowStockSql } from "../lib/low-stock";
import { taxInvoice, receivableInvoice, invoiceSign, activePurchase } from "../lib/tax-documents";
import { AiError, LANGUAGE_RULE, aiConfigured, appRate, generate, jsonOf, takeAiCredit, textOf, type Content, type Part } from "../lib/ai";
import type { TenantRequest } from "../lib/http";

/**
 * AI helpers. Every one of them only reads, and hands back text or a draft the
 * person checks and saves through the normal screens. Nothing here writes to
 * the books.
 */
const router: IRouter = Router();
type Req = TenantRequest<any>;

const Lang = z.enum(["en", "hi"]).default("en");
const langHint = (lang: "en" | "hi") => (lang === "hi" ? " The app is set to Hindi, so if the language is unclear, reply in Hindi." : "");
const todayIst = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Charges one AI action to the business, then runs the handler; AiError becomes its own status. */
function aiRoute(handler: (req: Req, res: express.Response) => Promise<unknown>) {
  return async (req: Req, res: express.Response) => {
    const businessId = req.businessId ?? req.user?.businessId;
    if (!businessId) return res.status(400).json({ error: "No business" });
    if (!aiConfigured()) return res.status(503).json({ error: "AI isn't set up yet. Ask your administrator to add the AI key.", code: "ai_off" });
    if (!takeAiCredit(businessId)) {
      return res.status(429).json({ error: "You've used today's AI limit. It resets at midnight.", code: "ai_limit" });
    }
    try {
      return await handler(req, res);
    } catch (err) {
      if (err instanceof AiError) return res.status(err.status).json({ error: err.message });
      throw err;
    }
  };
}

// ---------------------------------------------------------------- Ask your books

const DateRange = { from: { type: "string", description: "YYYY-MM-DD, inclusive" }, to: { type: "string", description: "YYYY-MM-DD, inclusive" } };
const TOOLS = [
  { name: "sales_and_purchases", description: "Sales, output GST, purchases and input GST per month for a date range. Credit notes subtract; cancelled invoices and proformas are left out.",
    parameters: { type: "object", properties: DateRange, required: ["from", "to"] } },
  { name: "customer_balances", description: "Customers who still owe money: amount owed, amount overdue, and how many invoices are open. Largest first.",
    parameters: { type: "object", properties: {} } },
  { name: "find_invoices", description: "Sales invoices, newest first (at most 25), with the total of all matches.",
    parameters: { type: "object", properties: { ...DateRange, customer: { type: "string", description: "part of the customer's name" },
      status: { type: "string", enum: ["unpaid", "partial", "paid", "cancelled", "overdue"] } } } },
  { name: "find_purchases", description: "Purchase bills, newest first (at most 25), with the total of all matches.",
    parameters: { type: "object", properties: { ...DateRange, vendor: { type: "string", description: "part of the vendor's name" } } } },
  { name: "product_sales", description: "Best-selling products by revenue for a date range (top 15).",
    parameters: { type: "object", properties: DateRange, required: ["from", "to"] } },
  { name: "stock", description: "Products with stock on hand, price and GST rate (at most 50).",
    parameters: { type: "object", properties: { name: { type: "string", description: "part of the product name" }, lowOnly: { type: "boolean" } } } },
  { name: "payments_summary", description: "Payments received and made in a date range, by payment mode.",
    parameters: { type: "object", properties: DateRange, required: ["from", "to"] } },
];

const date = (v: unknown, fallback: string) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : fallback);
const like = (v: unknown) => `%${String(v).replace(/[\\%_]/g, (m) => `\\${m}`).slice(0, 100)}%`;

/** Runs one tool for this business. Only the fixed queries below can run. */
export async function runTool(businessId: number, name: string, args: Record<string, unknown>): Promise<unknown> {
  const from = date(args["from"], "1900-01-01");
  const to = date(args["to"], "2999-12-31");
  const sign = invoiceSign(invoicesTable);
  switch (name) {
    case "sales_and_purchases": {
      const month = (c: any) => sql<string>`substring(${c} from 1 for 7)`;
      const [inv, pur] = [
        await db.select({ month: month(invoicesTable.invoiceDate), invoices: count(),
          sales: sqlSum(sql`${invoicesTable.grandTotal} * ${sign}`), outputGst: sqlSum(sql`${invoicesTable.totalGst} * ${sign}`) })
          .from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), taxInvoice(invoicesTable),
            gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)))
          .groupBy(month(invoicesTable.invoiceDate)),
        await db.select({ month: month(purchasesTable.invoiceDate), bills: count(),
          purchases: sqlSum(purchasesTable.grandTotal), inputGst: sqlSum(purchasesTable.totalGst) })
          .from(purchasesTable).where(and(eq(purchasesTable.businessId, businessId), activePurchase(purchasesTable),
            gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to)))
          .groupBy(month(purchasesTable.invoiceDate)),
      ];
      const months = [...new Set([...inv, ...pur].map((r) => r.month))].sort();
      return months.map((m) => {
        const i = inv.find((r) => r.month === m);
        const p = pur.find((r) => r.month === m);
        return { month: m, invoices: Number(i?.invoices ?? 0), sales: toJson(i?.sales ?? 0), outputGst: toJson(i?.outputGst ?? 0),
          bills: Number(p?.bills ?? 0), purchases: toJson(p?.purchases ?? 0), inputGst: toJson(p?.inputGst ?? 0) };
      });
    }
    case "customer_balances": {
      const today = todayIst();
      const owed = sql`${invoicesTable.grandTotal} - ${invoicesTable.paidAmount}`;
      const rows = await db.select({ customer: invoicesTable.customerName, openInvoices: count(), owed: sqlSum(owed),
        overdue: sql<string>`sum(${owed}) FILTER (WHERE ${invoicesTable.dueDate} < ${today})` })
        .from(invoicesTable).where(and(eq(invoicesTable.businessId, businessId), receivableInvoice(invoicesTable),
          sql`${invoicesTable.status} IN ('unpaid', 'partial')`))
        .groupBy(invoicesTable.customerName).orderBy(desc(sqlSum(owed))).limit(25);
      return rows.map((r) => ({ ...r, openInvoices: Number(r.openInvoices), owed: toJson(r.owed), overdue: toJson(r.overdue ?? 0) }));
    }
    case "find_invoices": {
      const where = [eq(invoicesTable.businessId, businessId), gte(invoicesTable.invoiceDate, from), lte(invoicesTable.invoiceDate, to)];
      if (args["customer"]) where.push(ilike(invoicesTable.customerName, like(args["customer"])));
      if (args["status"] === "overdue") {
        where.push(receivableInvoice(invoicesTable), sql`${invoicesTable.status} IN ('unpaid', 'partial')`, sql`${invoicesTable.dueDate} < ${todayIst()}`);
      } else if (typeof args["status"] === "string") where.push(eq(invoicesTable.status, args["status"]));
      const [rows, [agg]] = [
        await db.select({ number: invoicesTable.invoiceNumber, type: invoicesTable.type, customer: invoicesTable.customerName,
          date: invoicesTable.invoiceDate, due: invoicesTable.dueDate, status: invoicesTable.status,
          total: invoicesTable.grandTotal, paid: invoicesTable.paidAmount })
          .from(invoicesTable).where(and(...where)).orderBy(desc(invoicesTable.invoiceDate), desc(invoicesTable.id)).limit(25),
        await db.select({ n: count(), total: sqlSum(sql`${invoicesTable.grandTotal} * ${sign}`) }).from(invoicesTable).where(and(...where)),
      ];
      return { matches: Number(agg.n), totalOfMatches: toJson(agg.total ?? 0),
        invoices: rows.map((r) => ({ ...r, total: toJson(r.total), paid: toJson(r.paid) })) };
    }
    case "find_purchases": {
      const where = [eq(purchasesTable.businessId, businessId), gte(purchasesTable.invoiceDate, from), lte(purchasesTable.invoiceDate, to)];
      if (args["vendor"]) where.push(ilike(purchasesTable.vendorName, like(args["vendor"])));
      const [rows, [agg]] = [
        await db.select({ billNumber: purchasesTable.invoiceNumber, vendor: purchasesTable.vendorName, date: purchasesTable.invoiceDate,
          status: purchasesTable.status, total: purchasesTable.grandTotal, gst: purchasesTable.totalGst })
          .from(purchasesTable).where(and(...where)).orderBy(desc(purchasesTable.invoiceDate), desc(purchasesTable.id)).limit(25),
        await db.select({ n: count(), total: sqlSum(purchasesTable.grandTotal) }).from(purchasesTable).where(and(...where, activePurchase(purchasesTable))),
      ];
      return { matches: Number(agg.n), totalOfMatches: toJson(agg.total ?? 0),
        bills: rows.map((r) => ({ ...r, total: toJson(r.total), gst: toJson(r.gst) })) };
    }
    case "product_sales": {
      const result = await db.execute(sql`
        SELECT COALESCE(item->>'description', item->>'productName', '') AS product,
          SUM(COALESCE((item->>'quantity')::numeric, 0) * ${sign}) AS quantity,
          SUM(COALESCE((item->>'totalAmount')::numeric, 0) * ${sign}) AS revenue
        FROM ${invoicesTable} CROSS JOIN LATERAL jsonb_array_elements(${invoicesTable.items}) AS item
        WHERE ${invoicesTable.businessId} = ${businessId} AND ${taxInvoice(invoicesTable)}
          AND jsonb_typeof(${invoicesTable.items}) = 'array'
          AND ${invoicesTable.invoiceDate} >= ${from} AND ${invoicesTable.invoiceDate} <= ${to}
        GROUP BY 1 ORDER BY revenue DESC LIMIT 15`);
      const list = ((result as any).rows ?? result) as Array<Record<string, unknown>>;
      return list.map((r) => ({ product: String(r["product"]), quantity: Number(dec(r["quantity"]).toFixed(3)), revenue: toJson(r["revenue"]) }));
    }
    case "stock": {
      const where = [eq(productsTable.businessId, businessId), eq(productsTable.isActive, true)];
      if (args["name"]) where.push(ilike(productsTable.name, like(args["name"])));
      if (args["lowOnly"] === true) where.push(lowStockSql(productsTable));
      const rows = await db.select({ name: productsTable.name, unit: productsTable.unit, stock: productsTable.stockQuantity,
        lowStockAt: productsTable.lowStockThreshold, sellingPrice: productsTable.sellingPrice, gstRate: productsTable.gstRate, hsn: productsTable.hsnCode })
        .from(productsTable).where(and(...where)).orderBy(productsTable.name).limit(50);
      return rows.map((r) => ({ ...r, stock: Number(dec(r.stock).toFixed(3)), lowStockAt: r.lowStockAt === null ? null : Number(r.lowStockAt),
        sellingPrice: r.sellingPrice === null ? null : toJson(r.sellingPrice), gstRate: Number(r.gstRate) }));
    }
    case "payments_summary": {
      const rows = await db.select({ type: paymentsTable.type, mode: paymentsTable.mode, payments: count(), amount: sqlSum(paymentsTable.amount) })
        .from(paymentsTable).where(and(eq(paymentsTable.businessId, businessId), gte(paymentsTable.date, from), lte(paymentsTable.date, to)))
        .groupBy(paymentsTable.type, paymentsTable.mode);
      return rows.map((r) => ({ direction: r.type === "received" || r.type === "in" ? "received" : "paid out", mode: r.mode,
        payments: Number(r.payments), amount: toJson(r.amount) }));
    }
    default:
      return { error: `No tool called ${name}` };
  }
}

const AskBody = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({ role: z.enum(["user", "model"]), text: z.string().max(4000) })).max(10).default([]),
  lang: Lang,
});

router.post("/ask", requireAuth, requireBusiness, validateBody(AskBody), aiRoute(async (req, res) => {
  const { question, history, lang } = req.body as z.infer<typeof AskBody>;
  const [business] = await db.select({ name: businessesTable.name, state: businessesTable.state, gstin: businessesTable.gstin })
    .from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  const system = [
    `You are the assistant inside Billing Pilot, a GST billing app used in India. You help the owner of "${business?.name ?? "this business"}"` +
      `${business?.state ? ` in ${business.state}` : ""}${business?.gstin ? ` (GSTIN ${business.gstin})` : ""} understand their own books and GST.`,
    `Today is ${todayIst()}. The Indian financial year runs from 1 April to 31 March.`,
    "For any figure about this business, call the tools and use only what they return. Never guess or invent a figure. If the tools don't cover it, say so.",
    "You can answer general GST questions (rates, HSN/SAC, returns, due dates, input tax credit, e-way bills) from your own knowledge. Say briefly that rates and rules change and the person should confirm with their CA before filing.",
    "You cannot create, change, delete, send or file anything. If asked, say which screen in the app does it (Invoices, Purchases, Inventory, Customers, Vendors, Payments, Reports).",
    "Answer in a few short sentences or a short list. Write amounts as ₹ with Indian grouping, like ₹1,25,000. Name the period your figures cover. Plain text only, no tables or headings.",
    LANGUAGE_RULE + langHint(lang),
  ].join("\n");

  const contents: Content[] = [
    ...history.map((h) => ({ role: h.role, parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: question }] },
  ];
  // The request holds its database transaction while the AI thinks; stop well
  // inside the 60 s idle-in-transaction timeout.
  const deadline = Date.now() + 40_000;
  for (let round = 0; round < 5 && Date.now() < deadline; round++) {
    const reply = await generate({ system, contents, tools: TOOLS });
    const calls = reply.parts.filter((p) => p["functionCall"]).map((p) => p["functionCall"] as { name: string; args?: Record<string, unknown> });
    if (!calls.length) return res.json({ answer: textOf(reply) || "Sorry, I couldn't answer that. Try asking another way." });
    contents.push(reply);
    const results: Part[] = [];
    for (const call of calls.slice(0, 5)) {
      results.push({ functionResponse: { name: call.name, response: { result: await runTool(req.businessId, call.name, call.args ?? {}) } } });
    }
    contents.push({ role: "user", parts: results });
  }
  throw new AiError("That question needed too many steps. Try asking something narrower.", 422);
}));

// ---------------------------------------------------------------- Bill scan

const BILL_SCHEMA = {
  type: "object",
  properties: {
    vendorName: { type: "string" }, vendorGstin: { type: "string" }, billNumber: { type: "string" },
    billDate: { type: "string", description: "YYYY-MM-DD" },
    items: { type: "array", items: { type: "object", properties: {
      description: { type: "string" }, hsnCode: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" },
      unitPrice: { type: "number", description: "rate per unit before GST and after any discount" },
      gstRate: { type: "number", description: "total GST percent (CGST + SGST, or IGST): 0, 5, 12, 18 or 28" },
    }, required: ["description", "quantity", "unitPrice", "gstRate"] } },
    warnings: { type: "array", items: { type: "string" }, description: "anything unreadable or uncertain, in plain words" },
  },
  required: ["items"],
};

const BILL_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"];

router.post("/bill", requireAuth, express.raw({ type: BILL_TYPES, limit: "10mb" }), aiRoute(async (req, res) => {
  const mimeType = String(req.headers["content-type"] ?? "").split(";")[0]!.trim();
  if (!Buffer.isBuffer(req.body) || !req.body.length || !BILL_TYPES.includes(mimeType)) {
    return res.status(400).json({ error: "Send a photo (JPEG, PNG, WebP or HEIC) or a PDF of the bill." });
  }
  const lang = req.query["lang"] === "hi" ? "hi" : "en";
  const reply = await generate({
    system: "You read Indian GST purchase bills (tax invoices from suppliers) and copy what they say into JSON. Copy, never guess: " +
      "leave a field out if it isn't on the bill. Item names stay as printed. Dates become YYYY-MM-DD (Indian bills write day first). " +
      `Write the warnings ${lang === "hi" ? "in Hindi" : "in English"}.`,
    contents: [{ role: "user", parts: [{ inlineData: { mimeType, data: req.body.toString("base64") } }, { text: "Read this purchase bill." }] }],
    schema: BILL_SCHEMA,
  });
  const bill = jsonOf<any>(reply);
  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return res.json({
    vendorName: bill.vendorName ?? "", vendorGstin: String(bill.vendorGstin ?? "").toUpperCase().replace(/\s/g, ""),
    billNumber: bill.billNumber ?? "", billDate: date(bill.billDate, ""),
    items: (Array.isArray(bill.items) ? bill.items : []).slice(0, 200).map((it: any) => ({
      description: String(it.description ?? "").slice(0, 300), hsnCode: String(it.hsnCode ?? "").replace(/\s/g, "").slice(0, 8),
      quantity: num(it.quantity, 1), unit: String(it.unit || "Nos").slice(0, 20), unitPrice: num(it.unitPrice), gstRate: appRate(it.gstRate),
    })),
    warnings: Array.isArray(bill.warnings) ? bill.warnings.map(String).slice(0, 10) : [],
  });
}));

// ---------------------------------------------------------------- Invoice from a sentence

const DraftBody = z.object({ text: z.string().trim().min(3).max(2000), lang: Lang });
const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    customerId: { type: "integer", description: "id from the customer list, or 0 if none matches" },
    customerName: { type: "string" },
    items: { type: "array", items: { type: "object", properties: {
      productId: { type: "integer", description: "id from the product list, or 0 if none matches" },
      description: { type: "string" }, quantity: { type: "number" }, unit: { type: "string" },
      unitPrice: { type: "number", description: "price per unit before GST; 0 if not said and no product matches" },
      gstRate: { type: "number" }, discount: { type: "number", description: "discount percent" },
    }, required: ["description", "quantity"] } },
    dueInDays: { type: "integer" },
    notes: { type: "string" },
    questions: { type: "array", items: { type: "string" }, description: "what is unclear and should be checked" },
  },
  required: ["customerName", "items"],
};

router.post("/invoice-draft", requireAuth, requireBusiness, validateBody(DraftBody), aiRoute(async (req, res) => {
  const { text, lang } = req.body as z.infer<typeof DraftBody>;
  // ponytail: whole customer and product lists in the prompt, capped at 1000 each; search first if catalogs grow past that.
  const [customers, products] = [
    await db.select({ id: customersTable.id, name: customersTable.name, stateCode: customersTable.stateCode })
      .from(customersTable).where(eq(customersTable.businessId, req.businessId)).limit(1000),
    await db.select({ id: productsTable.id, name: productsTable.name, price: productsTable.sellingPrice, gstRate: productsTable.gstRate,
      hsn: productsTable.hsnCode, unit: productsTable.unit })
      .from(productsTable).where(and(eq(productsTable.businessId, req.businessId), eq(productsTable.isActive, true))).limit(1000),
  ];
  const reply = await generate({
    system: "You turn a short description of a sale into a draft GST sales invoice for an Indian business. " +
      "Match the customer and each item to the lists below by meaning, allowing for Hindi, Hinglish and spelling differences; use 0 when nothing matches. " +
      "For a matched product use its price and GST rate unless the text says otherwise. 'plus GST' means the price is before GST; " +
      "'including GST' means work the price back to before GST. Never invent prices. " +
      `Write customerName and descriptions as they should appear on the invoice. Write questions ${lang === "hi" ? "in Hindi" : "in English"}.\n` +
      `Customers: ${JSON.stringify(customers.map(({ id, name }) => ({ id, name })))}\n` +
      `Products: ${JSON.stringify(products)}`,
    contents: [{ role: "user", parts: [{ text }] }],
    schema: DRAFT_SCHEMA,
  });
  const draft = jsonOf<any>(reply);
  const customer = customers.find((c) => c.id === Number(draft.customerId));
  const num = (v: unknown, d = 0) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : d);
  return res.json({
    customerId: customer?.id ?? null,
    customerName: customer?.name ?? String(draft.customerName ?? "").slice(0, 200),
    stateCode: customer?.stateCode ?? "",
    items: (Array.isArray(draft.items) ? draft.items : []).slice(0, 100).map((it: any) => {
      const p = products.find((x) => x.id === Number(it.productId));
      return {
        productId: p?.id ?? null,
        description: p?.name ?? String(it.description ?? "").slice(0, 300),
        hsnCode: p?.hsn ?? "",
        quantity: num(it.quantity, 1) || 1,
        unit: p?.unit ?? String(it.unit || "Nos").slice(0, 20),
        unitPrice: num(it.unitPrice) || (p?.price ? toJson(p.price) : 0),
        gstRate: appRate(it.gstRate, p ? Number(p.gstRate) : 18),
        discount: Math.min(num(it.discount), 100),
      };
    }),
    dueInDays: Number.isInteger(draft.dueInDays) && draft.dueInDays >= 0 && draft.dueInDays <= 365 ? draft.dueInDays : null,
    notes: String(draft.notes ?? "").slice(0, 500),
    questions: Array.isArray(draft.questions) ? draft.questions.map(String).slice(0, 5) : [],
  });
}));

// ---------------------------------------------------------------- HSN and GST rate

const HsnBody = z.object({ name: z.string().trim().min(2).max(200), description: z.string().max(500).optional(), lang: Lang });

router.post("/hsn", requireAuth, validateBody(HsnBody), aiRoute(async (req, res) => {
  const { name, description, lang } = req.body as z.infer<typeof HsnBody>;
  const reply = await generate({
    system: "You suggest the HSN code (goods) or SAC code (services) and the GST rate in India for a product or service. " +
      "Give the most likely 4 to 8 digit code and the total GST percent. In 'reason', one or two short sentences on why, and say if the rate depends on " +
      `something such as price, packing or use. Write 'reason' ${lang === "hi" ? "in Hindi" : "in English"}.`,
    contents: [{ role: "user", parts: [{ text: `${name}${description ? `\n${description}` : ""}` }] }],
    schema: { type: "object", properties: { hsnCode: { type: "string" }, gstRate: { type: "number" }, reason: { type: "string" } }, required: ["hsnCode", "gstRate", "reason"] },
  });
  const s = jsonOf<any>(reply);
  return res.json({ hsnCode: String(s.hsnCode ?? "").replace(/\D/g, "").slice(0, 8), gstRate: appRate(s.gstRate), aiRate: Number(s.gstRate), reason: String(s.reason ?? "") });
}));

// ---------------------------------------------------------------- Payment reminder wording

const ReminderBody = z.object({ invoiceId: z.number().int().positive(), lang: Lang, tone: z.enum(["polite", "firm"]).default("polite") });

router.post("/reminder", requireAuth, requireBusiness, validateBody(ReminderBody), aiRoute(async (req, res) => {
  const { invoiceId, lang, tone } = req.body as z.infer<typeof ReminderBody>;
  const [inv] = await db.select().from(invoicesTable).where(and(eq(invoicesTable.id, invoiceId), eq(invoicesTable.businessId, req.businessId))).limit(1);
  if (!inv) return res.status(404).json({ error: "Not found" });
  const due = dec(inv.grandTotal).minus(dec(inv.paidAmount));
  if (inv.status === "cancelled" || due.lessThanOrEqualTo(0)) return res.status(400).json({ error: "Nothing is due on this invoice." });
  const [business] = await db.select({ name: businessesTable.name, upiId: businessesTable.upiId, phone: businessesTable.phone })
    .from(businessesTable).where(eq(businessesTable.id, req.businessId)).limit(1);
  const facts = { business: business?.name, customer: inv.customerName, invoice: inv.invoiceNumber, invoiceDate: inv.invoiceDate,
    dueDate: inv.dueDate, amountDue: `₹${toJson(due).toLocaleString("en-IN")}`, today: todayIst(), upiId: business?.upiId || undefined, phone: business?.phone || undefined };
  const reply = await generate({
    system: `You write a short ${tone} payment reminder that an Indian business owner sends a customer on WhatsApp or email. ` +
      `Write it ${lang === "hi" ? "in Hindi (Devanagari)" : "in English"}. Use only the facts given, keep it under 80 words, warm and respectful, ` +
      "no subject line, no placeholders, plain text, sign off with the business name. Mention the UPI ID for payment if one is given.",
    contents: [{ role: "user", parts: [{ text: JSON.stringify(facts) }] }],
  });
  return res.json({ message: textOf(reply) });
}));

export default router;
