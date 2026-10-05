/**
 * Request schemas for every route.
 *
 * These are hand-written rather than taken from `@workspace/api-zod`, and the
 * reason has changed. The spec used to describe an older API — walk-in
 * invoices, `description`/`unitPrice` line items, `billNumber`/`billDate`
 * purchases and the e-way bill routes were all missing or wrong — so enforcing
 * the generated schemas would have rejected requests the app makes every day.
 * That drift is now fixed, and `test/spec-contract.test.mjs` holds it fixed by
 * checking the generated schemas against the payloads the client really sends.
 *
 * What remains here is the part a contract cannot express: bounds that exist
 * because of this database and this tax regime. A GST rate capped at 28, money
 * stopping short of what `numeric(15, 2)` can hold, page sizes capped at 100,
 * text lengths matched to their columns. The spec says what the shape is; this
 * file says what a sane value is.
 *
 * Objects strip unknown keys rather than rejecting them, which is what closes
 * mass assignment: only the named fields reach the handler.
 */

import { z } from "zod";
import { INVOICE_TYPES } from "../lib/tax-documents";

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Text that lands in a `text` column. Bounded so nothing unbounded is stored. */
const shortText = (max = 200) => z.string().max(max);
const optionalText = (max = 200) => z.string().max(max).nullish();

/**
 * Whether `YYYY-MM-DD` names a day that exists. The shape alone accepted
 * `2026-04-31`, which sorts after April's last day and before May's first: an
 * invoice dated that way was counted by the dashboard and silently missing from
 * the GSTR-1 for both months, because reports select by comparing date strings.
 */
function isCalendarDate(value: string): boolean {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  if (y < 2000 || y > 2100) return false;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `YYYY-MM-DD`. Every date column in this schema is text, not `date`. */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date")
  .refine(isCalendarDate, "Not a real calendar date");

/**
 * An optional date that may be cleared. An empty string means "none" and is
 * stored as null: it used to be stored as `""`, and `"" < today` made the
 * dashboard count that invoice as overdue for ever.
 */
const optionalDate = z
  .union([dateString, z.literal(""), z.null()])
  .transform((value) => (value === "" ? null : value))
  .optional();

/** A row id. Bounded to `integer` so a larger one is a 400, not a driver error. */
const entityId = z.coerce.number().int().positive().max(2_147_483_647);

/**
 * Money. The numeric columns are `numeric(15, 2)`, so anything at or above
 * 10^13 is a write error rather than a validation error; stop short of that.
 */
const money = z.coerce.number().finite().min(0).max(1e12);
/** A sum of money actually received or paid: whole paise, nothing finer. */
const isWholePaise = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
const WHOLE_PAISE = { message: "Amounts cannot have more than 2 decimal places" };

/** `numeric(15, 3)` stock column. */
const quantity = z.coerce.number().finite().min(0).max(1e9);

/**
 * GST rate, as a percentage.
 *
 * Bounded at 28 — the highest GST slab — rather than enumerated to the exact
 * slab set. An enum would be tighter, but rejecting a legitimate rate blocks a
 * real invoice, and special rates (0.1, 1.5, 6, 7.5) exist alongside the
 * headline slabs. The bound is what matters here: it rules out the 900% rate
 * that `numeric(5, 2)` would otherwise happily store on a GSTR-1 filing.
 */
const gstRate = z.coerce.number().finite().min(0).max(28);

const gstin = z.string().max(15).nullish();
const stateCode = z.string().max(2).nullish();

// ---------------------------------------------------------------------------
// Pagination — the cap that makes `?limit=100000000` a 400 rather than a
// full-table read serialised to JSON.
// ---------------------------------------------------------------------------

export const MAX_PAGE_SIZE = 100;

export const paginationShape = {
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
};

export const Pagination = z.object(paginationShape);

const searchShape = { search: z.string().max(200).optional() };

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const LoginBody = z.object({
  email: z.string().max(320),
  // Deliberately NOT the policy schema: an existing password set before the
  // policy existed must still be able to sign in (and then be changed).
  password: z.string().max(1024),
});

/**
 * A new password. Length is enforced here so the client gets a field-level
 * error; `validatePassword` adds the breach-corpus check, which needs a
 * network round trip and so cannot live in a synchronous schema.
 */
const newPassword = z.string().min(12).max(128);

/**
 * No password: it is chosen when the emailed link is opened, not when the form
 * is submitted. See `pending-registrations.ts` for why.
 */
export const RegisterBody = z.object({
  name: shortText(200),
  email: z.string().email().max(320),
  businessName: shortText(200),
  gstin,
});

export const ChangePasswordBody = z.object({
  currentPassword: z.string().max(1024),
  newPassword,
});

// ---------------------------------------------------------------------------
// Users and admin
// ---------------------------------------------------------------------------

/**
 * Roles are an enum, not free text. `PATCH /users/:id` previously copied
 * whatever `role` string the body carried, so `{"role":"superadmin"}` wrote a
 * value no authorization check understands.
 */
export const roleEnum = z.enum(["user", "admin"]);

const subscriptionShape = {
  subscriptionStatus: z.enum(["trial", "monthly", "yearly", "expired"]).nullish(),
  subscriptionEnd: optionalDate,
};

export const ListUsersQuery = z.object({
  ...paginationShape,
  ...searchShape,
  status: z.enum(["active", "inactive"]).optional(),
});

/** The token from a verification link, and the password the person now chooses. */
export const VerifyRegistrationBody = z.object({
  token: z.string().min(1).max(512),
  password: newPassword,
});

export const CreateUserBody = z.object({
  name: shortText(200),
  email: z.string().email().max(320),
  password: newPassword,
  role: roleEnum,
  // The caller's own password. Required only when `role` is "admin" — creating
  // an administrator is a privilege grant and is confirmed like one. Validation
  // strips unknown keys, so without this field declared the step-up check would
  // never see it.
  confirmPassword: z.string().max(1024).optional(),
  ...subscriptionShape,
});

export const UpdateUserBody = z.object({
  name: shortText(200).optional(),
  email: z.string().email().max(320).optional(),
  role: roleEnum.optional(),
  confirmPassword: z.string().max(1024).optional(),
  ...subscriptionShape,
});

export const AdminUpdateUserBody = z.object({
  isActive: z.boolean().optional(),
  role: roleEnum.optional(),
  confirmPassword: z.string().max(1024).optional(),
  ...subscriptionShape,
});

export const ToggleStatusBody = z.object({ isActive: z.boolean() });

/** `confirmPassword` is the caller's own password — see middleware/step-up.ts. */
export const ResetPasswordBody = z.object({
  newPassword,
  confirmPassword: z.string().max(1024).optional(),
});

export const AdminListUsersQuery = z.object({ ...paginationShape, ...searchShape });

// ---------------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------------

export const UpdateBusinessBody = z.object({
  name: shortText(200).optional(),
  gstin,
  pan: optionalText(10),
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  stateCode,
  pincode: optionalText(10),
  phone: optionalText(20),
  email: optionalText(320),
  website: optionalText(300),
  invoicePrefix: optionalText(20),
  bankName: optionalText(200),
  bankAccount: optionalText(50),
  bankIfsc: optionalText(20),
  bankBranch: optionalText(200),
  termsConditions: optionalText(5000),
});

// ---------------------------------------------------------------------------
// Customers and vendors
// ---------------------------------------------------------------------------

const partyShape = {
  gstin,
  phone: optionalText(20),
  email: optionalText(320),
  address: optionalText(500),
  city: optionalText(100),
  state: optionalText(100),
  stateCode,
  pincode: optionalText(10),
};

export const ListPartiesQuery = z.object({ ...paginationShape, ...searchShape });

export const CreateCustomerBody = z.object({
  name: shortText(200),
  ...partyShape,
  creditLimit: money.nullish(),
});

export const UpdateCustomerBody = CreateCustomerBody.partial();

export const CreateVendorBody = z.object({ name: shortText(200), ...partyShape });

export const UpdateVendorBody = CreateVendorBody.partial();

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

export const ListProductsQuery = z.object({
  ...paginationShape,
  ...searchShape,
  lowStock: z.enum(["true", "false"]).optional(),
});

export const CreateProductBody = z.object({
  name: shortText(200),
  unit: shortText(20),
  sku: optionalText(60),
  hsnCode: optionalText(12),
  purchasePrice: money.nullish(),
  sellingPrice: money.nullish(),
  gstRate: gstRate.default(18),
  stockQuantity: quantity.default(0),
  lowStockThreshold: quantity.nullish(),
  description: optionalText(2000),
  category: optionalText(100),
});

export const UpdateProductBody = CreateProductBody.partial().extend({
  isActive: z.boolean().optional(),
});

// ---------------------------------------------------------------------------
// Invoices and purchases
// ---------------------------------------------------------------------------

/**
 * A line item. `unitPrice` is what the client sends; `rate` is the legacy name
 * the handler still falls back to, so both are accepted and either satisfies
 * the price. Totals (`taxableAmount`, `cgst`, …) are accepted and then ignored
 * — the server recomputes them in `calcGst`, and always has.
 */
const lineItem = z
  .object({
    productId: entityId.nullish(),
    description: shortText(500).optional(),
    productName: shortText(500).optional(),
    hsnCode: optionalText(12),
    quantity: quantity.default(1),
    unit: optionalText(20),
    unitPrice: money.optional(),
    rate: money.optional(),
    discount: z.coerce.number().finite().min(0).max(100).default(0),
    gstRate: gstRate.default(0),
  })
  .refine((i) => i.unitPrice !== undefined || i.rate !== undefined, {
    message: "Each item needs a unitPrice",
  })
  .refine((i) => Boolean(i.description ?? i.productName), {
    message: "Each item needs a description",
  });

/**
 * The most a document's lines may add up to before tax. The money columns are
 * `numeric(15, 2)`, so a total at or above 10^13 is a write error — and a
 * quantity of 10^9 at a price of 10^12 is each individually valid. Stop short
 * of the column with room for the highest GST slab on top.
 */
const MAX_DOCUMENT_AMOUNT = 1e12;

const lineAmount = (i: { quantity: number; unitPrice?: number; rate?: number }) =>
  i.quantity * (i.unitPrice ?? i.rate ?? 0);

/** A bill with no lines is almost always a client bug; a 500-line one is a payload attack. */
const lineItems = z
  .array(lineItem)
  .min(1)
  .max(500)
  .refine((items) => items.every((i) => lineAmount(i) <= MAX_DOCUMENT_AMOUNT), {
    message: "A line amount is too large",
  })
  .refine((items) => items.reduce((sum, i) => sum + lineAmount(i), 0) <= MAX_DOCUMENT_AMOUNT, {
    message: "The document total is too large",
  });

export const ListInvoicesQuery = z.object({
  ...paginationShape,
  ...searchShape,
  type: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
  customerId: entityId.optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
});

/**
 * The kinds of invoice the reports know how to treat: a credit note subtracts,
 * a proforma is not a tax document. A free-text type could say neither, so a
 * "Credit Note" was added to the liability it exists to reduce.
 */
const invoiceType = z.enum(INVOICE_TYPES);

export const CreateInvoiceBody = z
  .object({
    type: invoiceType.optional(),
    customerId: entityId.optional(),
    customerName: shortText(200).optional(),
    customerGstin: gstin,
    invoiceDate: dateString,
    dueDate: optionalDate,
    placeOfSupply: optionalText(2),
    notes: optionalText(2000),
    items: lineItems,
  })
  .refine((b) => b.customerId !== undefined || Boolean(b.customerName), {
    message: "customerId or customerName is required",
  });

export const UpdateInvoiceBody = z.object({
  type: invoiceType.optional(),
  customerId: entityId.optional(),
  invoiceDate: dateString.optional(),
  dueDate: optionalDate,
  placeOfSupply: optionalText(2),
  isInterstate: z.boolean().optional(),
  notes: optionalText(2000),
  items: lineItems.optional(),
});

export const UpdateInvoiceStatusBody = z
  .object({
    // The route reads `paymentStatus ?? status`; accept either name.
    status: z.enum(["paid", "unpaid", "partial", "cancelled"]).optional(),
    paymentStatus: z.enum(["paid", "unpaid", "partial", "cancelled"]).optional(),
    paidAmount: money.refine(isWholePaise, WHOLE_PAISE).optional(),
    // How the money arrived, recorded on the payment this creates.
    mode: z.string().max(50).optional(),
    referenceNumber: z.string().max(200).optional(),
  })
  .refine(
    (b) =>
      b.status !== undefined ||
      b.paymentStatus !== undefined ||
      b.paidAmount !== undefined,
    { message: "Nothing to update" },
  );

export const ListPurchasesQuery = z.object({
  ...paginationShape,
  ...searchShape,
  vendorId: entityId.optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
});

/** `billNumber`/`billDate` are the client's names; the DB columns are invoice*. */
export const CreatePurchaseBody = z
  .object({
    vendorId: entityId,
    billNumber: optionalText(60),
    invoiceNumber: optionalText(60),
    billDate: dateString.optional(),
    invoiceDate: dateString.optional(),
    dueDate: optionalDate,
    notes: optionalText(2000),
    items: lineItems,
  })
  .refine((b) => Boolean(b.billDate ?? b.invoiceDate), {
    message: "billDate is required",
  });

export const UpdatePurchaseBody = z.object({
  vendorId: entityId.optional(),
  billNumber: optionalText(60),
  invoiceNumber: optionalText(60),
  billDate: dateString.optional(),
  invoiceDate: dateString.optional(),
  dueDate: optionalDate,
  notes: optionalText(2000),
  items: lineItems.optional(),
  paymentStatus: z.enum(["paid", "unpaid", "partial", "cancelled"]).optional(),
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export const ListPaymentsQuery = z.object({
  ...paginationShape,
  type: z.enum(["in", "out", "received", "paid"]).optional(),
});

export const CreatePaymentBody = z.object({
  type: z.enum(["received", "paid", "in", "out"]),
  // Strictly positive: direction is the `type`, not the sign. A negative amount
  // let a "received" payment subtract, and zero recorded nothing.
  amount: z.coerce.number().finite().positive().max(1e12).refine(isWholePaise, WHOLE_PAISE),
  date: dateString,
  mode: shortText(30),
  referenceNumber: optionalText(100),
  invoiceId: entityId.nullish(),
  customerId: entityId.nullish(),
  vendorId: entityId.nullish(),
  notes: optionalText(2000),
});

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export const MAX_REPORT_SPAN_DAYS = 366;

export const MonthYearQuery = z.object({
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});

/**
 * `/reports/sales` and `/reports/purchases` had no pagination and no required
 * range, so with no filter they read and serialised every invoice a business
 * had ever raised. Rather than truncating a financial report — which would be
 * worse than slow — the span itself is bounded, and an absent range defaults
 * to the current month.
 */
export const DateRangeQuery = z
  .object({
    fromDate: dateString.optional(),
    toDate: dateString.optional(),
  })
  .refine(
    (q) => {
      if (!q.fromDate || !q.toDate) return true;
      const from = Date.parse(`${q.fromDate}T00:00:00Z`);
      const to = Date.parse(`${q.toDate}T00:00:00Z`);
      if (Number.isNaN(from) || Number.isNaN(to)) return true;
      return to >= from && to - from <= MAX_REPORT_SPAN_DAYS * 86_400_000;
    },
    { message: `Date range must be forwards and at most ${MAX_REPORT_SPAN_DAYS} days` },
  );

// ---------------------------------------------------------------------------
// E-way bills — absent from the OpenAPI spec, so defined only here.
// ---------------------------------------------------------------------------

/**
 * Defaults to a full page rather than the usual 20: the page that lists these
 * has no pager, and shrinking it silently would hide bills. The cap is what
 * matters — the list used to be unbounded.
 */
export const ListEwayBillsQuery = z.object({
  page: paginationShape.page,
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(MAX_PAGE_SIZE),
});

/** Most bytes of free-form line records one e-way bill may carry. */
const MAX_EWAY_ITEMS_BYTES = 100_000;

export const CreateEwayBillBody = z.object({
  supplyType: optionalText(5),
  subSupplyType: optionalText(5),
  docType: optionalText(10),
  docNo: shortText(60),
  docDate: dateString,
  fromGstin: gstin,
  fromTrdName: optionalText(200),
  fromAddr1: optionalText(300),
  fromCity: optionalText(100),
  fromState: optionalText(100),
  fromPincode: optionalText(10),
  toGstin: gstin,
  toTrdName: optionalText(200),
  toAddr1: optionalText(300),
  toCity: optionalText(100),
  toState: optionalText(100),
  toPincode: optionalText(10),
  transMode: optionalText(5),
  transDistance: z.coerce.number().finite().min(0).max(10_000).nullish(),
  transporterName: optionalText(200),
  transporterId: optionalText(20),
  transDocNo: optionalText(60),
  transDocDate: optionalDate,
  vehicleNo: optionalText(20),
  vehicleType: optionalText(5),
  totalValue: money.nullish(),
  cgstValue: money.nullish(),
  sgstValue: money.nullish(),
  igstValue: money.nullish(),
  totalInvValue: money.nullish(),
  // Count alone allowed ~1 MB per bill (the request limit) of arbitrary JSON,
  // stored and later returned in full. Bound the size, not just the length.
  items: z
    .array(z.record(z.string(), z.unknown()))
    .max(500)
    .refine((items) => JSON.stringify(items).length <= MAX_EWAY_ITEMS_BYTES, {
      message: `items may not exceed ${MAX_EWAY_ITEMS_BYTES} bytes`,
    })
    .default([]),
  invoiceId: entityId.nullish(),
});

export const UpdateEwayBillBody = z.object({
  status: z.enum(["draft", "generated", "cancelled"]).optional(),
  ewbNo: optionalText(20),
  ewbDate: optionalText(40),
  validUpto: optionalText(40),
  transMode: optionalText(5),
  transDistance: z.coerce.number().finite().min(0).max(10_000).nullish(),
  transporterName: optionalText(200),
  transporterId: optionalText(20),
  transDocNo: optionalText(60),
  transDocDate: optionalDate,
  vehicleNo: optionalText(20),
  vehicleType: optionalText(5),
});

// ---------------------------------------------------------------------------
// Route params
// ---------------------------------------------------------------------------

/**
 * `:id` was read with a bare `parseInt`, so `/customers/abc` produced `NaN`
 * and a driver-level error rather than a 400.
 */
export const IdParam = z.object({
  // Plain decimal digits. `z.coerce.number()` read "0x10" as 16 and "1e3" as
  // 1000, so `/customers/0x10` addressed customer 16.
  id: z.string().regex(/^\d{1,10}$/, "Expected a numeric id").transform(Number).pipe(entityId),
});
