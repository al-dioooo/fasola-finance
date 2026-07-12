import type { FormEvent } from "react";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";

import { api, ApiError, buildQuery } from "../api/client";
import type { Expense, ExpenseCategory, ExpensesResponse } from "../api/types";
import {
  Badge,
  Button,
  Card,
  CardTitle,
  EmptyState,
  ErrorNote,
  Field,
  Input,
  PageHeader,
  Pagination,
  Select,
  SkeletonRows
} from "../components/ui";
import { AnimatedNumber, Rise, StaggerItem, StaggerList } from "../components/motion/primitives";
import { formatDateJakarta, formatIDR, todayJakarta } from "../lib/format";
import { expenseCategoryLabels } from "../lib/labels";

const PAGE_LIMIT = 20;

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

// Shared <option> list for every category select on the page.
function CategoryOptions({ options }: { options: CategoryOption[] }) {
  return (
    <>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

// Numeric rupiah input with an "Rp" prefix affordance and a live formatted hint.
function AmountField({
  label,
  value,
  onChange,
  placeholder
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const parsed = parseAmount(value);

  return (
    <Field label={label} {...(parsed === null ? {} : { hint: formatIDR(parsed) })}>
      <div className="relative">
        <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm font-medium text-ink-400">
          Rp
        </span>
        <Input
          type="text"
          inputMode="numeric"
          required
          value={value}
          onChange={(event) => onChange(onlyDigits(event.target.value))}
          className="pl-10"
          {...(placeholder ? { placeholder } : {})}
        />
      </div>
    </Field>
  );
}

// Pandan-tinted quick-add card; owns its own form state so a successful save
// can reset amount/description without touching the rest of the page.
function QuickAddCard({
  categoryOptions,
  onSaved
}: {
  categoryOptions: CategoryOption[];
  onSaved: () => Promise<void>;
}) {
  const [expenseDate, setExpenseDate] = useState(() => todayJakarta());
  const [category, setCategory] = useState<ExpenseCategory>("bahan_baku");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");

  const createMutation = useMutation({
    mutationFn: (body: CreateExpenseBody) =>
      api<{ expense: Expense }>("/api/expenses", { method: "POST", body }),
    onSuccess: async () => {
      setAmount("");
      setDescription("");
      await onSaved();
    }
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

  return (
    <section className="rounded-card border border-pandan-200 bg-pandan-50 p-4 shadow-card sm:p-5">
      <CardTitle>Tambah Pengeluaran</CardTitle>
      <form onSubmit={handleCreate} className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Tanggal">
          <Input
            type="date"
            required
            value={expenseDate}
            onChange={(event) => setExpenseDate(event.target.value)}
          />
        </Field>
        <Field label="Kategori">
          <Select
            value={category}
            onChange={(event) => setCategory(event.target.value as ExpenseCategory)}
          >
            <CategoryOptions options={categoryOptions} />
          </Select>
        </Field>
        <AmountField label="Jumlah" value={amount} onChange={setAmount} placeholder="cth. 50000" />
        <Field label="Keterangan (opsional)">
          <Input
            type="text"
            placeholder="cth. Belanja ayam 5 kg"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
          />
        </Field>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={createMutation.isPending}
            disabled={parseAmount(amount) === null}
          >
            Simpan
          </Button>
        </div>
        <AnimatePresence>
          {createMutation.isError ? (
            <motion.div
              className="sm:col-span-2"
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              <ErrorNote
                message={errorMessage(createMutation.error, "Gagal menyimpan pengeluaran.")}
              />
            </motion.div>
          ) : null}
        </AnimatePresence>
      </form>
    </section>
  );
}

// Read-only expense row: muted date, kunyit category badge, right-aligned amount.
function ExpenseRow({
  expense,
  onEdit,
  onDelete,
  deleting
}: {
  expense: Expense;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs tabular-nums text-ink-400">
            {formatDateJakarta(expense.expenseDate)}
          </span>
          <Badge className="bg-kunyit-100 text-kunyit-800">
            {expenseCategoryLabels[expense.category]}
          </Badge>
        </div>
        <p className="mt-1 text-sm text-ink-600">{expense.description ?? "—"}</p>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1.5">
        <span className="font-display text-base font-semibold tabular-nums text-ink-900">
          {formatIDR(expense.amount)}
        </span>
        <div className="flex gap-1.5">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            Edit
          </Button>
          <Button variant="dangerOutline" size="sm" onClick={onDelete} disabled={deleting}>
            Hapus
          </Button>
        </div>
      </div>
    </div>
  );
}

// Compact inline editor that replaces a row while an expense is being edited.
function ExpenseEditForm({
  editing,
  categoryOptions,
  saving,
  onChange,
  onSubmit,
  onCancel
}: {
  editing: EditState;
  categoryOptions: CategoryOption[];
  saving: boolean;
  onChange: (next: EditState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-2">
      <Field label="Tanggal">
        <Input
          type="date"
          required
          value={editing.expenseDate}
          onChange={(event) => onChange({ ...editing, expenseDate: event.target.value })}
        />
      </Field>
      <Field label="Kategori">
        <Select
          value={editing.category}
          onChange={(event) =>
            onChange({ ...editing, category: event.target.value as ExpenseCategory })
          }
        >
          <CategoryOptions options={categoryOptions} />
        </Select>
      </Field>
      <AmountField
        label="Jumlah"
        value={editing.amount}
        onChange={(value) => onChange({ ...editing, amount: value })}
      />
      <Field label="Keterangan (opsional)">
        <Input
          type="text"
          value={editing.description}
          onChange={(event) => onChange({ ...editing, description: event.target.value })}
        />
      </Field>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" loading={saving} disabled={parseAmount(editing.amount) === null}>
          Simpan
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Batal
        </Button>
      </div>
    </form>
  );
}

// "Total periode" strip: tiny uppercase caption, display-serif figure.
function PeriodTotal({ value }: { value: number }) {
  return (
    <div className="mt-4 flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-cream-200 bg-cream-100 px-3.5 py-2.5">
      <span className="text-xs font-semibold tracking-wide text-ink-500 uppercase">
        Total periode
      </span>
      <span className="font-display text-xl font-semibold tabular-nums text-pandan-800">
        <AnimatedNumber value={value} format={formatIDR} />
      </span>
    </div>
  );
}

export function ExpensesPage() {
  const queryClient = useQueryClient();

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

  return (
    <div>
      <Rise>
        <PageHeader title="Pengeluaran" subtitle="Catat belanja dapur dan operasional" />
      </Rise>

      <div className="space-y-4">
        <Rise>
          <QuickAddCard categoryOptions={categoryOptions} onSaved={invalidateList} />
        </Rise>

        <Rise>
          <Card>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Bulan">
                <Input
                  type="month"
                  value={month}
                  onChange={(event) => {
                    setMonth(event.target.value);
                    setPage(1);
                  }}
                />
              </Field>
              <Field label="Kategori">
                <Select
                  value={categoryFilter}
                  onChange={(event) => {
                    setCategoryFilter(event.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Semua kategori</option>
                  <CategoryOptions options={categoryOptions} />
                </Select>
              </Field>
            </div>

            {listQuery.isPending ? (
              <div className="mt-4">
                <SkeletonRows rows={5} />
              </div>
            ) : null}
            {listQuery.isError ? (
              <div className="mt-4">
                <ErrorNote message={errorMessage(listQuery.error, "Gagal memuat pengeluaran.")} />
              </div>
            ) : null}

            {updateMutation.isError ? (
              <div className="mt-4">
                <ErrorNote
                  message={errorMessage(updateMutation.error, "Gagal mengubah pengeluaran.")}
                />
              </div>
            ) : null}
            {deleteMutation.isError ? (
              <div className="mt-4">
                <ErrorNote
                  message={errorMessage(deleteMutation.error, "Gagal menghapus pengeluaran.")}
                />
              </div>
            ) : null}

            {listQuery.data ? (
              <>
                <PeriodTotal value={listQuery.data.periodTotal} />

                {listQuery.data.items.length === 0 ? (
                  <EmptyState emoji="🧾" message="Belum ada pengeluaran bulan ini." />
                ) : (
                  <StaggerList className="mt-2 divide-y divide-cream-200">
                    {listQuery.data.items.map((expense) => (
                      <StaggerItem key={expense.expenseId}>
                        <AnimatePresence mode="wait" initial={false}>
                          {editing && editing.expenseId === expense.expenseId ? (
                            <motion.div
                              key="edit"
                              initial={{ opacity: 0, y: -4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -4 }}
                              transition={{ duration: 0.15 }}
                            >
                              <ExpenseEditForm
                                editing={editing}
                                categoryOptions={categoryOptions}
                                saving={updateMutation.isPending}
                                onChange={setEditing}
                                onSubmit={handleEditSave}
                                onCancel={() => setEditing(null)}
                              />
                            </motion.div>
                          ) : (
                            <motion.div
                              key="view"
                              initial={{ opacity: 0, y: 4 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: 4 }}
                              transition={{ duration: 0.15 }}
                            >
                              <ExpenseRow
                                expense={expense}
                                onEdit={() => startEdit(expense)}
                                onDelete={() => handleDelete(expense.expenseId)}
                                deleting={deleteMutation.isPending}
                              />
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </StaggerItem>
                    ))}
                  </StaggerList>
                )}

                <Pagination
                  page={page}
                  limit={PAGE_LIMIT}
                  total={listQuery.data.total}
                  onPageChange={setPage}
                />
              </>
            ) : null}
          </Card>
        </Rise>
      </div>
    </div>
  );
}
