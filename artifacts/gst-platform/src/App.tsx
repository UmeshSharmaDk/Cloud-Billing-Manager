import { lazy, Suspense } from "react";
import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { AppShell } from "@/components/AppShell";
import { ShellSkeleton } from "@/components/ui/skeleton";
import LoginPage from "@/pages/login";
const NotFound = lazy(() => import("@/pages/not-found"));
const DashboardPage = lazy(() => import("@/pages/dashboard"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const InvoiceNewPage = lazy(() => import("@/pages/invoice-new"));
const InvoiceDetailPage = lazy(() => import("@/pages/invoice-detail"));
const PurchasesPage = lazy(() => import("@/pages/purchases"));
const PurchaseNewPage = lazy(() => import("@/pages/purchase-new"));
const PurchaseDetailPage = lazy(() => import("@/pages/purchase-detail"));
const InventoryPage = lazy(() => import("@/pages/inventory"));
const ProductNewPage = lazy(() => import("@/pages/product-new"));
const ProductDetailPage = lazy(() => import("@/pages/product-detail"));
const CustomersPage = lazy(() => import("@/pages/customers"));
const CustomerNewPage = lazy(() => import("@/pages/customer-new"));
const CustomerDetailPage = lazy(() => import("@/pages/customer-detail"));
const VendorsPage = lazy(() => import("@/pages/vendors"));
const VendorNewPage = lazy(() => import("@/pages/vendor-new"));
const VendorDetailPage = lazy(() => import("@/pages/vendor-detail"));
const PaymentsPage = lazy(() => import("@/pages/payments"));
const ReportsPage = lazy(() => import("@/pages/reports"));
const EwayBillsPage = lazy(() => import("@/pages/eway-bills"));
const EwayBillNewPage = lazy(() => import("@/pages/eway-bill-new"));
const EwayBillDetailPage = lazy(() => import("@/pages/eway-bill-detail"));
const SettingsPage = lazy(() => import("@/pages/settings"));
const AdminDashboardPage = lazy(() => import("@/pages/admin-dashboard"));
const AdminUsersPage = lazy(() => import("@/pages/admin-users"));
const AdminUserDetailPage = lazy(() => import("@/pages/admin-user-detail"));
const SuperadminDashboardPage = lazy(() => import("@/pages/superadmin-dashboard"));
const AcceptAdminInvitePage = lazy(() => import("@/pages/accept-admin-invite"));
const SecurityPage = lazy(() => import("@/pages/security"));
const DemoPage = lazy(() => import("@/pages/demo"));
const ForgotPasswordPage = lazy(() => import("@/pages/password-reset").then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => import("@/pages/password-reset").then((m) => ({ default: m.ResetPasswordPage })));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 1000 * 60 } }
});

function ProtectedRoute({ component: Component, adminOnly = false }: { component: React.ComponentType; adminOnly?: boolean }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <ShellSkeleton />;
  if (!user) return <Redirect to="/login" />;
  if (adminOnly && user.role !== "admin") return <Redirect to="/dashboard" />;
  if (!adminOnly && user.role !== "user") {
    return <Redirect to={user.role === "superadmin" ? "/superadmin" : "/admin"} />;
  }
  return <AppShell><Component /></AppShell>;
}

function AdminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <ShellSkeleton />;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "admin") return <Redirect to="/dashboard" />;
  if (!user.mfaEnabled) return <Redirect to="/security" />;
  return <AppShell><Component /></AppShell>;
}

function SuperadminRoute({ component: Component }: { component: React.ComponentType }) {
  const { user, isLoading } = useAuth();
  if (isLoading) return <ShellSkeleton />;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "superadmin") return <Redirect to={user.role === "admin" ? "/admin" : "/dashboard"} />;
  if (!user.mfaEnabled) return <Redirect to="/security" />;
  return <AppShell><Component /></AppShell>;
}

/** Two-factor setup. Reachable by administrators before they have it. */
function SecurityRoute() {
  const { user, isLoading } = useAuth();
  if (isLoading) return <ShellSkeleton />;
  if (!user) return <Redirect to="/login" />;
  if (user.role !== "admin" && user.role !== "superadmin") return <Redirect to="/dashboard" />;
  return <AppShell><SecurityPage /></AppShell>;
}

function Router() {
  return (
    <Switch>
      <Route path="/login" component={LoginPage} />
      <Route path="/accept-admin-invite" component={AcceptAdminInvitePage} />
      <Route path="/demo" component={DemoPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
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
      <Route path="/eway-bills">{() => <ProtectedRoute component={EwayBillsPage} />}</Route>
      <Route path="/eway-bills/new">{() => <ProtectedRoute component={EwayBillNewPage} />}</Route>
      <Route path="/eway-bills/:id">{() => <ProtectedRoute component={EwayBillDetailPage} />}</Route>
      <Route path="/settings">{() => <ProtectedRoute component={SettingsPage} />}</Route>
      <Route path="/admin">{() => <AdminRoute component={AdminDashboardPage} />}</Route>
      <Route path="/admin/users">{() => <AdminRoute component={AdminUsersPage} />}</Route>
      <Route path="/admin/users/:id">{() => <AdminRoute component={AdminUserDetailPage} />}</Route>
      <Route path="/superadmin">{() => <SuperadminRoute component={SuperadminDashboardPage} />}</Route>
      <Route path="/security" component={SecurityRoute} />
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
            {/* Pages load on demand, so the sign-in screen does not download the whole app. */}
            <Suspense fallback={<ShellSkeleton />}>
              <Router />
            </Suspense>
            <Toaster />
          </AuthProvider>
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
