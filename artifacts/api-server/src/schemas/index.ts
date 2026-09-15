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

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** Text that lands in a `text` column. Bounded so nothing unbounded is stored. */
const shortText = (max = 200) => z.string().max(max);
const optionalText = (max = 200) => z.string().max(max).nullish();

/** `YYYY-MM-DD`. Every date column in this schema is text, not `date`. */
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Expected a YYYY-MM-DD date");

/**
 * Money. The numeric columns are `numeric(15, 2)`, so anything at or above
 * 10^13 is a write error rather than a validation error; stop short of that.
 */
const money = z.coerce.number().finite().min(0).max(1e12);
const signedMoney = z.coerce.number().finite().min(-1e12).max(1e12);

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

export const RegisterBody = z.object({
  name: shortText(200),
  email: z.string().email().max(320),
  password: newPassword,
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
  subscriptionEnd: z.union([dateString, z.literal(""), z.null()]).optional(),
};

export const ListUsersQuery = z.object({
  ...paginationShape,
  ...searchShape,
  status: z.enum(["active", "inactive"]).optional(),
});

/** The token from a verification link. Opaque to the client. */
export const VerifyRegistrationBody = z.object({
  token: z.string().min(1).max(512),
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
    productId: z.coerce.number().int().positive().nullish(),
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

/** A bill with no lines is almost always a client bug; a 500-line one is a payload attack. */
const lineItems = z.array(lineItem).min(1).max(500);

export const ListInvoicesQuery = z.object({
  ...paginationShape,
  ...searchShape,
  type: z.string().max(50).optional(),
  status: z.string().max(30).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
});

export const CreateInvoiceBody = z
  .object({
    type: shortText(50).optional(),
    customerId: z.coerce.number().int().positive().optional(),
    customerName: shortText(200).optional(),
    customerGstin: gstin,
    invoiceDate: dateString,
    dueDate: z.union([dateString, z.literal(""), z.null()]).optional(),
    placeOfSupply: optionalText(2),
    notes: optionalText(2000),
    items: lineItems,
  })
  .refine((b) => b.customerId !== undefined || Boolean(b.customerName), {
    message: "customerId or customerName is required",
  });

export const UpdateInvoiceBody = z.object({
  type: shortText(50).optional(),
  customerId: z.coerce.number().int().positive().optional(),
  invoiceDate: dateString.optional(),
  dueDate: z.union([dateString, z.literal(""), z.null()]).optional(),
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
    paidAmount: money.optional(),
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
  vendorId: z.coerce.number().int().positive().optional(),
  fromDate: dateString.optional(),
  toDate: dateString.optional(),
});

/** `billNumber`/`billDate` are the client's names; the DB columns are invoice*. */
export const CreatePurchaseBody = z
  .object({
    vendorId: z.coerce.number().int().positive(),
    billNumber: optionalText(60),
    invoiceNumber: optionalText(60),
    billDate: dateString.optional(),
    invoiceDate: dateString.optional(),
    dueDate: z.union([dateString, z.literal(""), z.null()]).optional(),
    notes: optionalText(2000),
    items: lineItems,
  })
  .refine((b) => Boolean(b.billDate ?? b.invoiceDate), {
    message: "billDate is required",
  });

export const UpdatePurchaseBody = z.object({
  vendorId: z.coerce.number().int().positive().optional(),
  billNumber: optionalText(60),
  invoiceNumber: optionalText(60),
  billDate: dateString.optional(),
  invoiceDate: dateString.optional(),
  dueDate: z.union([dateString, z.literal(""), z.null()]).optional(),
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
  type: shortText(20),
  amount: signedMoney,
  date: dateString,
  mode: shortText(30),
  referenceNumber: optionalText(100),
  invoiceId: z.coerce.number().int().positive().nullish(),
  customerId: z.coerce.number().int().positive().nullish(),
  vendorId: z.coerce.number().int().positive().nullish(),
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
  transDocDate: z.union([dateString, z.literal(""), z.null()]).optional(),
  vehicleNo: optionalText(20),
  vehicleType: optionalText(5),
  totalValue: money.nullish(),
  cgstValue: money.nullish(),
  sgstValue: money.nullish(),
  igstValue: money.nullish(),
  totalInvValue: money.nullish(),
  items: z.array(z.record(z.string(), z.unknown())).max(500).default([]),
  invoiceId: z.coerce.number().int().positive().nullish(),
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
  transDocDate: z.union([dateString, z.literal(""), z.null()]).optional(),
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
  id: z.coerce.number().int().positive().max(2_147_483_647),
});
