import { useMutation, useQueryClient } from "@tanstack/react-query";
import { NavLink, Outlet, useNavigate } from "react-router";

import { api } from "../api/client";

const NAV_ITEMS = [
  { to: "/", label: "Beranda", end: true },
  { to: "/orders", label: "Pesanan", end: false },
  { to: "/menu", label: "Menu", end: false },
  { to: "/expenses", label: "Pengeluaran", end: false },
  { to: "/reports", label: "Laporan", end: false },
  { to: "/bot", label: "Bot", end: false }
];

export function Layout() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const logout = useMutation({
    mutationFn: () => api("/api/auth/logout", { method: "POST" }),
    onSuccess: async () => {
      queryClient.clear();
      await navigate("/login");
    }
  });

  return (
    <div className="min-h-screen pb-20 sm:pb-0">
      <header className="bg-emerald-800 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-semibold">Dapoer Mami Fasola</h1>
          <button
            type="button"
            onClick={() => logout.mutate()}
            className="rounded px-2 py-1 text-sm text-emerald-100 hover:bg-emerald-700"
          >
            Keluar
          </button>
        </div>
        <nav className="mx-auto hidden max-w-5xl gap-1 px-4 pb-2 sm:flex">
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded px-3 py-1.5 text-sm ${
                  isActive ? "bg-white text-emerald-900" : "text-emerald-100 hover:bg-emerald-700"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">
        <Outlet />
      </main>

      {/* Bottom tab bar for phones — the owner mostly uses a phone. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 flex justify-around border-t border-stone-200 bg-white py-1 sm:hidden">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded px-2 py-1.5 text-xs ${
                isActive ? "font-semibold text-emerald-800" : "text-stone-500"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
