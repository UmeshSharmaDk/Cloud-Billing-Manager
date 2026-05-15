import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppShell } from "@/components/AppShell";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import RegisterPage from "@/pages/register";
import DashboardPage from "@/pages/dashboard";
import InvoicesPage from "@/pages/invoices";
import InvoiceNewPage from "@/pages/invoice-new";
import InvoiceDetailPage from "@/pages/invoice-detail";
import PurchasesPage from "@/pages/purchases";
import PurchaseNewPage from "@/pages/purchase-new";
import PurchaseDetailPage from "@/pages/purchase-detail";
import InventoryPage from "@/pages/inventory";
import ProductNewPage from "@/pages/product-new";
import ProductDetailPage from "@/pages/product-detail";
import CustomersPage from "@/pages/customers";
import CustomerNewPage from "@/pages/customer-new";
import CustomerDetailPage from "@/pages/customer-detail";
import VendorsPage from "@/pages/vendors";
import VendorNewPage from "@/pages/vendor-new";
import VendorDetailPage from "@/pages/vendor-detail";
import PaymentsPage from "@/pages/payments";
import ReportsPage from "@/pages/reports";
import SettingsPage from "@/pages/settings";
import AdminDashboardPage from "@/pages/admin-dashboard";
import AdminUsersPage from "@/pages/admin-users";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1000 * 60 } }
});

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Redirect to="/login" />;
  if (adminOnly && user.role !== "admin") return <Redirect to="/dashboard" />;
  if (!adminOnly && user.role === "admin") return <Redirect to="/admin" />;
  return <AppShell><Component /></AppShell>;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "admin") return <Redirect to="/dashboard" />;
  return <AppShell><Component /></AppShell>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/">{() => <Redirect to="/login" />}</Route>
      <Route path="/dashboard">{() => <ProtectedRoute component={DashboardPage} />}</Route>
      <Route path="/invoices">{() => <ProtectedRoute component={InvoicesPage} />}</Route>
      <Route path="/invoices/new">{() => <ProtectedRoute component={InvoiceNewPage} />}</Route>
      <Route path="/invoices/:id">{() => <ProtectedRoute component={InvoiceDetailPage} />}</Route>
      <Route path="/purchases">{() => <ProtectedRoute component={PurchasesPage} />}</Route>
      <Route path="/purchases/new">{() => <ProtectedRoute component={PurchaseNewPage} />}</Route>
      <Route path="/purchases/:id">{() => <ProtectedRoute component={PurchaseDetailPage} />}</Route>
      <Route path="/inventory">{() => <ProtectedRoute component={InventoryPage} />}</Route>
      <Route path="/inventory/new">{() => <ProtectedRoute component={ProductNewPage} />}</Route>
      <Route path="/inventory/:id">{() => <ProtectedRoute component={ProductDetailPage} />}</Route>
      <Route path="/customers">{() => <ProtectedRoute component={CustomersPage} />}</Route>
      <Route path="/customers/new">{() => <ProtectedRoute component={CustomerNewPage} />}</Route>
      <Route path="/customers/:id">{() => <ProtectedRoute component={CustomerDetailPage} />}</Route>
      <Route path="/vendors">{() => <ProtectedRoute component={VendorsPage} />}</Route>
      <Route path="/vendors/new">{() => <ProtectedRoute component={VendorNewPage} />}</Route>
      <Route path="/vendors/:id">{() => <ProtectedRoute component={VendorDetailPage} />}</Route>
      <Route path="/payments">{() => <ProtectedRoute component={PaymentsPage} />}</Route>
      <Route path="/reports">{() => <ProtectedRoute component={ReportsPage} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} />}</Route>
      <Route path="/admin">{() => <AdminRoute component={AdminDashboardPage} />}</Route>
      <Route path="/admin/users">{() => <AdminRoute component={AdminUsersPage} />}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <Router />
            <Toaster />
          </AuthProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
