// Hand-copied from lib/api-spec/openapi.yaml: only the fields this app reads.
export type User = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | "superadmin" | string;
  isActive: boolean;
  mfaEnabled?: boolean;
  subscriptionStatus?: string | null;
  subscriptionEnd?: string | null;
  /** The last day sign-in works (a user inherits their admin's). Only from GET /auth/me. */
  planEnd?: string | null;
  createdAt?: string;
  /** An admin who requires two-factor sign-in of their users. */
  requireTeamMfa?: boolean;
  /** This user's admin requires two-factor sign-in. Only from GET /auth/me. */
  mfaRequired?: boolean;
};

export type DashboardStats = {
  totalSales: number;
  totalPurchases: number;
  totalGstPayable: number;
  totalOutstanding: number;
  invoiceCount: number;
  customerCount: number;
  overdueInvoiceCount?: number;
  lowStockCount?: number;
};

export type Customer = {
  id: number;
  name: string;
  gstin?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  pincode?: string | null;
  stateCode?: string | null;
  creditLimit?: number | null;
  outstandingBalance?: number | null;
};

export type Vendor = Customer;

export type InvoiceItem = {
  id?: number;
  productId?: number | null;
  discount?: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  description?: string;
  hsnCode?: string | null;
  quantity: number;
  unit?: string | null;
  unitPrice?: number;
  gstRate: number;
  taxableAmount?: number;
  totalAmount?: number;
};

export type Invoice = {
  id: number;
  invoiceNumber: string;
  type: string;
  status: string;
  customerId: number;
  customerName: string;
  customerGstin?: string | null;
  invoiceDate: string;
  dueDate?: string | null;
  placeOfSupply?: string | null;
  isInterstate?: boolean;
  subtotal: number;
  cgst?: number;
  sgst?: number;
  igst?: number;
  totalGst: number;
  roundOff?: number;
  grandTotal: number;
  paidAmount?: number;
  notes?: string | null;
  items?: InvoiceItem[];
  /** Present on a single invoice with a balance due when the business has a UPI ID. */
  upi?: { link: string; amount: number; qr: string } | null;
  /** The dashboard offers a copy of it each new month. */
  repeatMonthly?: boolean;
  /** From the IRP once the e-invoice is registered; `irnQr` is the signed QR as an image. */
  irn?: string | null;
  irnAckNo?: string | null;
  irnAckDate?: string | null;
  irnQr?: string | null;
};

export type Product = {
  id: number;
  name: string;
  sku?: string | null;
  hsnCode?: string | null;
  unit: string;
  purchasePrice?: number | null;
  sellingPrice?: number | null;
  gstRate: number;
  stockQuantity: number;
  lowStockThreshold?: number | null;
  description?: string | null;
  category?: string | null;
};

export type Purchase = {
  id: number;
  vendorId: number;
  vendorName: string;
  vendorGstin?: string | null;
  invoiceNumber: string;
  invoiceDate: string;
  status: string;
  subtotal: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalGst: number;
  grandTotal: number;
  notes?: string | null;
  items: InvoiceItem[];
};

export type Payment = {
  id: number;
  type: string;
  amount: number;
  date: string;
  mode: string;
  referenceNumber?: string | null;
  notes?: string | null;
};

export type EwayBill = {
  id: number;
  docNo: string;
  docDate: string;
  status: "draft" | "generated" | "cancelled";
  ewbNo?: string | null;
  ewbDate?: string | null;
  validUpto?: string | null;
  vehicleNo?: string | null;
  totalInvValue?: number;
  [k: string]: unknown;
};

export type AccessLevel = "full" | "entry" | "view" | null;
export const ACCESS = [
  { value: "full", label: "Full: everything the owner can do" },
  { value: "entry", label: "Data entry: add and edit, no deleting or settings" },
  { value: "view", label: "View only: for interns or clients" },
];

export type Business = Record<string, string | number | null> & { id: number; name: string };
