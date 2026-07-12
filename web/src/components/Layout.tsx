import { useMutation, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router";

import { api } from "../api/client";
import { PageTransition } from "./motion/primitives";

// shortLabel keeps the 7-item phone bottom bar from overflowing at 375px.
const NAV_ITEMS = [
  { to: "/", label: "Beranda", end: true },
  { to: "/orders", label: "Pesanan", end: false },
  { to: "/menu", label: "Menu", end: false },
  { to: "/expenses", label: "Pengeluaran", end: false },
  { to: "/reports", label: "Laporan", end: false },
  { to: "/bot", label: "Bot", end: false },
  { to: "/settings", label: "Info Usaha", shortLabel: "Info", end: false }
];

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/login");
    }
  });

  return (
    <div className="min-h-dvh pb-24 sm:pb-10">
      <header className="pattern-batik bg-pandan-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 pt-4 pb-3 sm:pt-5">
          <div className="flex items-baseline gap-2">
            <h1 className="font-display text-xl font-semibold text-cream-50 sm:text-2xl">
              Dapoer Mami Fasola
            </h1>
            <span aria-hidden className="hidden text-xs font-medium text-pandan-300 sm:inline">
              ● finance
            </span>
          </div>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded-full border border-pandan-700 px-3 py-1.5 text-xs font-semibold text-pandan-100 transition-colors hover:bg-pandan-800"
          >
            Keluar
          </button>
        </div>

        {/* Desktop nav: sliding pill indicator. */}
        <nav className="mx-auto hidden max-w-5xl gap-1 px-4 pb-3 sm:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="relative">
              {({ isActive }) => (
                <span
                  className={`relative block rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors ${
                    isActive ? "text-pandan-900" : "text-pandan-200 hover:text-cream-50"
                  }`}
                >
                  {isActive ? (
                    <motion.span
                      layoutId="desktop-nav-pill"
                      className="absolute inset-0 rounded-full bg-cream-100 shadow-card"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  ) : null}
                  <span className="relative">{item.label}</span>
                </span>
              )}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-5">
        {/* Re-keying by pathname gives every navigation one orchestrated reveal. */}
        <PageTransition key={location.pathname}>
          <Outlet />
        </PageTransition>
      </main>

      {/* Phone bottom bar — the owner's primary navigation. */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-cream-200 bg-cream-50/90 pb-[max(env(safe-area-inset-bottom),0.375rem)] backdrop-blur-md sm:hidden">
        <div className="flex justify-around pt-1.5">
          {NAV_ITEMS.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className="relative">
              {({ isActive }) => (
                <span
                  className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-semibold whitespace-nowrap transition-colors ${
                    isActive ? "text-pandan-800" : "text-ink-400"
                  }`}
                >
                  {"shortLabel" in item ? item.shortLabel : item.label}
                  {isActive ? (
                    <motion.span
                      layoutId="mobile-nav-dot"
                      className="h-1 w-4 rounded-full bg-pandan-600"
                      transition={{ type: "spring", stiffness: 400, damping: 32 }}
                    />
                  ) : (
                    <span className="h-1 w-4" />
                  )}
                </span>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
