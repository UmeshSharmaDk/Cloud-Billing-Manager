import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatCurrency(amount: number | string | null | undefined): string {
  const num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (isNaN(num)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2 }).format(num);
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "-";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function statusBadge(status: string): string {
  switch (status?.toLowerCase()) {
    case "paid": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "unpaid": return "bg-red-100 text-red-800 border-red-200";
    case "partial": return "bg-amber-100 text-amber-800 border-amber-200";
    case "active": return "bg-emerald-100 text-emerald-800 border-emerald-200";
    case "inactive": return "bg-gray-100 text-gray-600 border-gray-200";
    case "trial": return "bg-blue-100 text-blue-800 border-blue-200";
    case "monthly": return "bg-indigo-100 text-indigo-800 border-indigo-200";
    case "yearly": return "bg-violet-100 text-violet-800 border-violet-200";
    case "expired": return "bg-red-100 text-red-800 border-red-200";
    default: return "bg-gray-100 text-gray-600 border-gray-200";
  }
}
