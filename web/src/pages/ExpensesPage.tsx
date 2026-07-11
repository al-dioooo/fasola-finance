import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, ApiError, buildQuery } from "../api/client";
import type { Expense, ExpenseCategory, ExpensesResponse } from "../api/types";
import { Card, EmptyNote, ErrorNote, Spinner } from "../components/ui";
import { formatDateJakarta, formatIDR, todayJakarta } from "../lib/format";
import { expenseCategoryLabels } from "../lib/labels";

const PAGE_LIMIT = 20;

const INPUT_CLASS =
  "w-full rounded border border-stone-300 bg-white px-2 py-1.5 text-sm text-stone-900 " +
  "focus:border-emerald-600 focus:outline-none";

const PRIMARY_BUTTON_CLASS =
  "rounded bg-emerald-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-800 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

const SECONDARY_BUTTON_CLASS =
  "rounded border border-stone-300 px-3 py-1.5 text-sm text-stone-700 hover:bg-stone-100 " +
  "disabled:cursor-not-allowed disabled:opacity-50";

interface CategoryOption {
  value: ExpenseCategory;
  label: string;
}

interface CategoriesResponse {
  categories: CategoryOption[];
}

interface CreateExpenseBody {
  expenseDate: string;
  category: ExpenseCategory;
  amount: number;
  description?: string;
}

interface UpdateExpenseBody {
  expenseDate: string;
  category: ExpenseCategory;
  amount: number;
  description: string | null;
}

interface EditState {
  expenseId: string;
  expenseDate: string;
  category: ExpenseCategory;
  amount: string;
  description: string;
}

const FALLBACK_CATEGORIES: CategoryOption[] = (
  Object.keys(expenseCategoryLabels) as ExpenseCategory[]
).map((value) => ({ value, label: expenseCategoryLabels[value] }));

function currentJakartaMonth(): string {
  return todayJakarta().slice(0, 7);
}

// First/last business date of a YYYY-MM month via string math only — business
// dates are Asia/Jakarta calendar days and must never go through local Date math.
function monthToRange(month: string): { from?: string; to?: string } {
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return {};
  }

  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const monthLengths = [31, isLeapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const lastDay = monthLengths[monthNumber - 1] ?? 31;

  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function onlyDigits(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

function parseAmount(value: string): number | null {
  if (!/^\d+$/.test(value)) {
    return null;
  }

  const amount = Number(value);
  return Number.isSafeInteger(amount) && amount > 0 ? amount : null;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

function AmountHint({ amount }: { amount: string }) {
  const parsed = parseAmount(amount);

  if (parsed === null) {
    return null;
  }

  return <p className="mt-1 text-xs text-stone-500">{formatIDR(parsed)}</p>;
}

export function ExpensesPage() {
  const queryClient = useQueryClient();

  // Quick-add form.
  const [expenseDate, setExpenseDate] = useState(() => todayJakarta());
  const [category, setCategory] = useState<ExpenseCategory>("bahan_baku");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  // Filters + pagination.
  const [month, setMonth] = useState(() => currentJakartaMonth());
  const [categoryFilter, setCategoryFilter] = useState("");
  const [page, setPage] = useState(1);

  // Inline row edit.
  const [editing, setEditing] = useState<EditState | null>(null);

  const categoriesQuery = useQuery({
    queryKey: ["expenses", "categories"],
    queryFn: () => api<CategoriesResponse>("/api/expenses/categories"),
    staleTime: 5 * 60_000
  });

  const categoryOptions = categoriesQuery.data?.categories ?? FALLBACK_CATEGORIES;

  const { from, to } = monthToRange(month);

  const listQuery = useQuery({
    queryKey: ["expenses", "list", { from, to, category: categoryFilter, page }],
    queryFn: () =>
      api<ExpensesResponse>(
        `/api/expenses${buildQuery({ from, to, category: categoryFilter, page, limit: PAGE_LIMIT })}`
      )
  });

  const invalidateList = () => queryClient.invalidateQueries({ queryKey: ["expenses", "list"] });

  const createMutation = useMutation({
    mutationFn: (body: CreateExpenseBody) =>
      api<{ expense: Expense }>("/api/expenses", { method: "POST", body }),
    onSuccess: async () => {
      setAmount("");
      setDescription("");
      await invalidateList();
    }
  });

  const updateMutation = useMutation({
    mutationFn: (input: { expenseId: string; body: UpdateExpenseBody }) =>
      api<{ expense: Expense }>(`/api/expenses/${encodeURIComponent(input.expenseId)}`, {
        method: "PATCH",
        body: input.body
      }),
    onSuccess: async () => {
      setEditing(null);
      await invalidateList();
    }
  });

  const deleteMutation = useMutation({
    mutationFn: (expenseId: string) =>
      api<{ deleted: boolean }>(`/api/expenses/${encodeURIComponent(expenseId)}`, {
        method: "DELETE"
      }),
    onSuccess: () => invalidateList()
  });

  function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const amountValue = parseAmount(amount);

    if (amountValue === null) {
      return;
    }

    const trimmed = description.trim();
    createMutation.mutate({
      expenseDate,
      category,
      amount: amountValue,
      ...(trimmed === "" ? {} : { description: trimmed })
    });
  }

  function handleEditSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!editing) {
      return;
    }

    const amountValue = parseAmount(editing.amount);

    if (amountValue === null) {
      return;
    }

    const trimmed = editing.description.trim();
    updateMutation.mutate({
      expenseId: editing.expenseId,
      body: {
        expenseDate: editing.expenseDate,
        category: editing.category,
        amount: amountValue,
        description: trimmed === "" ? null : trimmed
      }
    });
  }

  function startEdit(expense: Expense) {
    setEditing({
      expenseId: expense.expenseId,
      expenseDate: expense.expenseDate,
      category: expense.category,
      amount: String(expense.amount),
      description: expense.description ?? ""
    });
  }

  function handleDelete(expenseId: string) {
    if (window.confirm("Hapus pengeluaran ini?")) {
      deleteMutation.mutate(expenseId);
    }
  }

  const total = listQuery.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_LIMIT));

  return (
    <div className="space-y-4">
      <Card>
        <h2 className="text-sm font-semibold text-stone-900">Tambah Pengeluaran</h2>
        <form onSubmit={handleCreate} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-xs text-stone-500">Tanggal</span>
            <input
              type="date"
              required
              value={expenseDate}
              onChange={(event) => setExpenseDate(event.target.value)}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500">Kategori</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
              className={`mt-1 ${INPUT_CLASS}`}
            >
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-stone-500">Jumlah (Rp)</span>
            <input
              type="text"
              inputMode="numeric"
              required
              placeholder="cth. 50000"
              value={amount}
              onChange={(event) => setAmount(onlyDigits(event.target.value))}
              className={`mt-1 ${INPUT_CLASS}`}
            />
            <AmountHint amount={amount} />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500">Keterangan (opsional)</span>
            <input
              type="text"
              placeholder="cth. Belanja ayam 5 kg"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </label>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={createMutation.isPending || parseAmount(amount) === null}
              className={PRIMARY_BUTTON_CLASS}
            >
              {createMutation.isPending ? "Menyimpan..." : "Simpan"}
            </button>
          </div>
          {createMutation.isError ? (
            <div className="sm:col-span-2">
              <ErrorNote
                message={errorMessage(createMutation.error, "Gagal menyimpan pengeluaran.")}
              />
            </div>
          ) : null}
        </form>
      </Card>

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="text-xs text-stone-500">Bulan</span>
            <input
              type="month"
              value={month}
              onChange={(event) => {
                setMonth(event.target.value);
                setPage(1);
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            />
          </label>
          <label className="block">
            <span className="text-xs text-stone-500">Kategori</span>
            <select
              value={categoryFilter}
              onChange={(event) => {
                setCategoryFilter(event.target.value);
                setPage(1);
              }}
              className={`mt-1 ${INPUT_CLASS}`}
            >
              <option value="">Semua kategori</option>
              {categoryOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3">
          {listQuery.isPending ? <Spinner label="Memuat pengeluaran..." /> : null}
          {listQuery.isError ? (
            <ErrorNote message={errorMessage(listQuery.error, "Gagal memuat pengeluaran.")} />
          ) : null}

          {updateMutation.isError ? (
            <div className="mb-2">
              <ErrorNote
                message={errorMessage(updateMutation.error, "Gagal mengubah pengeluaran.")}
              />
            </div>
          ) : null}
          {deleteMutation.isError ? (
            <div className="mb-2">
              <ErrorNote
                message={errorMessage(deleteMutation.error, "Gagal menghapus pengeluaran.")}
              />
            </div>
          ) : null}

          {listQuery.data ? (
            <>
              <p className="text-sm font-medium text-stone-900">
                Total periode: {formatIDR(listQuery.data.periodTotal)}
              </p>

              {listQuery.data.items.length === 0 ? (
                <EmptyNote message="Belum ada pengeluaran pada periode ini." />
              ) : (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                        <th className="py-2 pr-2 font-medium">Tanggal</th>
                        <th className="py-2 pr-2 font-medium">Kategori</th>
                        <th className="py-2 pr-2 font-medium">Keterangan</th>
                        <th className="py-2 pr-2 text-right font-medium">Jumlah</th>
                        <th className="py-2 text-right font-medium">Aksi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listQuery.data.items.map((expense) =>
                        editing && editing.expenseId === expense.expenseId ? (
                          <tr key={expense.expenseId} className="border-b border-stone-100">
                            <td colSpan={5} className="py-3">
                              <form
                                onSubmit={handleEditSave}
                                className="grid grid-cols-1 gap-3 sm:grid-cols-2"
                              >
                                <label className="block">
                                  <span className="text-xs text-stone-500">Tanggal</span>
                                  <input
                                    type="date"
                                    required
                                    value={editing.expenseDate}
                                    onChange={(event) =>
                                      setEditing({ ...editing, expenseDate: event.target.value })
                                    }
                                    className={`mt-1 ${INPUT_CLASS}`}
                                  />
                                </label>
                                <label className="block">
                                  <span className="text-xs text-stone-500">Kategori</span>
                                  <select
                                    value={editing.category}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        category: event.target.value as ExpenseCategory
                                      })
                                    }
                                    className={`mt-1 ${INPUT_CLASS}`}
                                  >
                                    {categoryOptions.map((option) => (
                                      <option key={option.value} value={option.value}>
                                        {option.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <label className="block">
                                  <span className="text-xs text-stone-500">Jumlah (Rp)</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    required
                                    value={editing.amount}
                                    onChange={(event) =>
                                      setEditing({
                                        ...editing,
                                        amount: onlyDigits(event.target.value)
                                      })
                                    }
                                    className={`mt-1 ${INPUT_CLASS}`}
                                  />
                                  <AmountHint amount={editing.amount} />
                                </label>
                                <label className="block">
                                  <span className="text-xs text-stone-500">
                                    Keterangan (opsional)
                                  </span>
                                  <input
                                    type="text"
                                    value={editing.description}
                                    onChange={(event) =>
                                      setEditing({ ...editing, description: event.target.value })
                                    }
                                    className={`mt-1 ${INPUT_CLASS}`}
                                  />
                                </label>
                                <div className="flex gap-2 sm:col-span-2">
                                  <button
                                    type="submit"
                                    disabled={
                                      updateMutation.isPending ||
                                      parseAmount(editing.amount) === null
                                    }
                                    className={PRIMARY_BUTTON_CLASS}
                                  >
                                    {updateMutation.isPending ? "Menyimpan..." : "Simpan"}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditing(null)}
                                    disabled={updateMutation.isPending}
                                    className={SECONDARY_BUTTON_CLASS}
                                  >
                                    Batal
                                  </button>
                                </div>
                              </form>
                            </td>
                          </tr>
                        ) : (
                          <tr key={expense.expenseId} className="border-b border-stone-100">
                            <td className="py-2 pr-2 whitespace-nowrap">
                              {formatDateJakarta(expense.expenseDate)}
                            </td>
                            <td className="py-2 pr-2 whitespace-nowrap">
                              {expenseCategoryLabels[expense.category]}
                            </td>
                            <td className="py-2 pr-2 text-stone-600">
                              {expense.description ?? "—"}
                            </td>
                            <td className="py-2 pr-2 text-right whitespace-nowrap">
                              {formatIDR(expense.amount)}
                            </td>
                            <td className="py-2 text-right whitespace-nowrap">
                              <button
                                type="button"
                                onClick={() => startEdit(expense)}
                                className="rounded px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(expense.expenseId)}
                                disabled={deleteMutation.isPending}
                                className="rounded px-2 py-1 text-xs font-medium text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                              >
                                Hapus
                              </button>
                            </td>
                          </tr>
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-3 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={page <= 1 || listQuery.isFetching}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Sebelumnya
                </button>
                <span className="text-xs text-stone-500">
                  Halaman {page} dari {totalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={page >= totalPages || listQuery.isFetching}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  Berikutnya
                </button>
              </div>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
