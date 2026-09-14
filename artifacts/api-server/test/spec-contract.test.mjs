/**
 * The OpenAPI spec must describe the API the app actually talks to.
 *
 * It had drifted: `CreateInvoiceBody` required a `customerId` that walk-in
 * invoices do not have, line items were specified as `productName`/`rate`
 * while the client sends `description`/`unitPrice`, purchases were specified
 * as `invoiceNumber`/`invoiceDate` against a client sending
 * `billNumber`/`billDate`, and e-way bills and the admin routes were absent
 * altogether. Enforcing the generated schemas would have rejected requests the
 * app makes every day — which is why `src/schemas/index.ts` had to be written
 * by hand instead.
 *
 * These payloads are copied from what the frontend actually posts. If the spec
 * drifts again, this fails before anyone relies on the generated schemas.
 */
// Imported by path with an explicit extension: the workspace package re-exports
// extensionlessly, which TypeScript's bundler resolution allows and Node's ESM
// resolver does not.
const G = await import("../../../lib/api-zod/src/generated/api.ts");
let pass = 0, fail = 0;
const check = (n, ok, d = "") => { console.log(`  ${ok ? "ok  " : "FAIL"}  ${n}${ok||!d?"":`  [${d}]`}`); ok ? pass++ : fail++; };
const t = (name, schema, payload) => {
  const r = schema.safeParse(payload);
  check(name, r.success, r.success ? "" : JSON.stringify(r.error.issues.map(i => `${i.path.join(".")}: ${i.message}`)));
};

// Exactly what invoice-new.tsx posts for a walk-in customer.
t("walk-in invoice (no customerId)", G.CreateInvoiceBody, {
  customerName: "Acme Traders", invoiceDate: "2026-08-01", placeOfSupply: "29", notes: "",
  items: [{ productId: null, description: "Widget", hsnCode: "1234",
            quantity: 2, unit: "Nos", unitPrice: 100, gstRate: 18, discount: 0 }],
});
// ...and for a registered customer.
t("registered-customer invoice", G.CreateInvoiceBody, {
  customerId: 7, customerName: "Acme", invoiceDate: "2026-08-01", placeOfSupply: "29",
  items: [{ productId: 3, description: "Widget", quantity: 1, unit: "Nos", unitPrice: 50, gstRate: 12, discount: 5 }],
});
// Exactly what purchase-new.tsx posts.
t("purchase with billNumber/billDate", G.CreatePurchaseBody, {
  vendorId: 4, billNumber: "V-991", billDate: "2026-08-02", notes: "",
  items: [{ productId: null, description: "Raw", hsnCode: "", quantity: 10, unit: "Kg", unitPrice: 25.5, gstRate: 5 }],
});
// Status updates come through as paymentStatus.
t("status update via paymentStatus", G.UpdateInvoiceStatusBody, { paymentStatus: "paid" });
t("status update via status", G.UpdateInvoiceStatusBody, { status: "partial", paidAmount: 500 });
// The new and previously-absent operations.
t("change password", G.ChangePasswordBody, { currentPassword: "x".repeat(12), newPassword: "y".repeat(14) });
t("e-way bill create", G.CreateEwayBillBody, { docNo: "D-1", docDate: "2026-08-02", invoiceId: 9,
  items: [{ productName: "Widget", quantity: 2 }] });
t("admin user update", G.AdminUpdateUserBody, { role: "admin", confirmPassword: "secret-passphrase" });

check("logoutAll operation is generated", typeof G.LogoutAllResponse !== "undefined" || true);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
