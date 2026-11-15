// Hand-copied from lib/api-spec/openapi.yaml: only the fields this app reads.
export type User = {
  id: number;
  name: string;
  email: string;
  role: "user" | "admin" | "superadmin" | string;
  isActive: boolean;
  subscriptionEnd?: string | null;
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
  outstandingBalance?: number | null;
};

export type InvoiceItem = {
  id?: number;
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
};
