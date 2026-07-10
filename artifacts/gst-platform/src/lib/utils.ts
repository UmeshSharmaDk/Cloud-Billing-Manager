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

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function threeDigitsToWords(n: number): string {
  let str = "";
  if (n >= 100) { str += ONES[Math.floor(n / 100)] + " Hundred "; n %= 100; }
  if (n >= 20) { str += TENS[Math.floor(n / 10)] + " "; n %= 10; }
  if (n > 0) str += ONES[n] + " ";
  return str.trim();
}

/** Converts a rupee amount to words using the Indian numbering system (Crore/Lakh/Thousand). */
export function amountToWords(amount: number | string | null | undefined): string {
  let num = typeof amount === "string" ? parseFloat(amount) : (amount ?? 0);
  if (isNaN(num)) num = 0;
  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);

  if (rupees === 0 && paise === 0) return "Zero Rupees Only";

  let n = rupees;
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh = Math.floor(n / 100000); n %= 100000;
  const thousand = Math.floor(n / 1000); n %= 1000;
  const hundred = n;

  let words = "";
  if (crore) words += threeDigitsToWords(crore) + " Crore ";
  if (lakh) words += threeDigitsToWords(lakh) + " Lakh ";
  if (thousand) words += threeDigitsToWords(thousand) + " Thousand ";
  if (hundred) words += threeDigitsToWords(hundred) + " ";
  words = words.trim();

  let result = words ? `${words} Rupees` : "Zero Rupees";
  if (paise > 0) result += ` and ${threeDigitsToWords(paise)} Paise`;
  return `${result} Only`.toUpperCase();
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
