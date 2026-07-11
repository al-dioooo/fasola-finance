import { useQuery } from "@tanstack/react-query";
import { Navigate, Route, Routes, useLocation } from "react-router";

import { api, ApiError } from "./api/client";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { BotOpsPage } from "./pages/BotOpsPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ExpensesPage } from "./pages/ExpensesPage";
import { LoginPage } from "./pages/LoginPage";
import { MenuPage } from "./pages/MenuPage";
import { OrderDetailPage } from "./pages/OrderDetailPage";
import { OrdersPage } from "./pages/OrdersPage";
import { ReportsPage } from "./pages/ReportsPage";

function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => api<{ authenticated: boolean }>("/api/auth/me"),
    retry: false,
    staleTime: 60_000
  });
}

export function App() {
  const location = useLocation();
  const auth = useAuth();

  if (auth.isPending) {
    return <Spinner label="Memuat..." />;
  }

  const authenticated =
    auth.data?.authenticated === true && !(auth.error instanceof ApiError);

  if (!authenticated && location.pathname !== "/login") {
    return <Navigate to="/login" replace />;
  }

  if (authenticated && location.pathname === "/login") {
    return <Navigate to="/" replace />;
  }

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/orders" element={<OrdersPage />} />
        <Route path="/orders/:orderId" element={<OrderDetailPage />} />
        <Route path="/menu" element={<MenuPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/bot" element={<BotOpsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
