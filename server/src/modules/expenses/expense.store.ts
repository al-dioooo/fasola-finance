import type { Db } from "../../db/client.js";
import type { ExpenseCategory } from "../../shared/enums.js";

export interface ExpenseRecord {
  expenseId: string;
  expenseDate: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListExpensesFilters {
  from: string | undefined;
  to: string | undefined;
  category: ExpenseCategory | undefined;
  limit: number;
  offset: number;
}

export interface ListExpensesResult {
  items: ExpenseRecord[];
  total: number;
  periodTotal: number;
}

export interface CreateExpenseInput {
  expenseId: string;
  expenseDate: string;
  category: ExpenseCategory;
  description: string | null;
  amount: number;
}

export interface UpdateExpenseInput {
  expenseDate?: string;
  category?: ExpenseCategory;
  description?: string | null;
  amount?: number;
}

interface ExpenseRow {
  expense_id: string;
  expense_date: string;
  category: ExpenseCategory;
  description: string | null;
  amount: string;
  created_at: Date;
  updated_at: Date;
}

interface TotalsRow {
  total: string;
  period_total: string;
}

// expense_date::text avoids pg's DATE -> local-midnight JS Date conversion;
// business dates stay plain 'YYYY-MM-DD' strings end to end.
const SELECT_COLUMNS = `
  expense_id,
  expense_date::text AS expense_date,
  category,
  description,
  amount,
  created_at,
  updated_at
`;

function mapRow(row: ExpenseRow): ExpenseRecord {
  return {
    expenseId: row.expense_id,
    expenseDate: row.expense_date,
    category: row.category,
    description: row.description,
    amount: Number(row.amount),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

export interface ExpenseStore {
  list(filters: ListExpensesFilters): Promise<ListExpensesResult>;
  create(input: CreateExpenseInput): Promise<ExpenseRecord>;
  update(expenseId: string, input: UpdateExpenseInput): Promise<ExpenseRecord | null>;
  remove(expenseId: string): Promise<boolean>;
}

export function createExpenseStore(db: Db): ExpenseStore {
  return {
    async list(filters) {
      const conditions: string[] = [];
      const params: unknown[] = [];

      if (filters.from !== undefined) {
        params.push(filters.from);
        conditions.push(`expense_date >= $${params.length}`);
      }
      if (filters.to !== undefined) {
        params.push(filters.to);
        conditions.push(`expense_date <= $${params.length}`);
      }
      if (filters.category !== undefined) {
        params.push(filters.category);
        conditions.push(`category = $${params.length}`);
      }

      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

      // periodTotal covers the whole filtered set, deliberately ignoring pagination.
      const totals = await db.query<TotalsRow>(
        `SELECT count(*) AS total, coalesce(sum(amount), 0) AS period_total
           FROM fin_expenses ${where}`,
        params
      );

      const itemsParams = [...params, filters.limit, filters.offset];
      const items = await db.query<ExpenseRow>(
        `SELECT ${SELECT_COLUMNS}
           FROM fin_expenses ${where}
          ORDER BY expense_date DESC, created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        itemsParams
      );

      const totalsRow = totals.rows[0];

      return {
        items: items.rows.map(mapRow),
        total: totalsRow ? Number(totalsRow.total) : 0,
        periodTotal: totalsRow ? Number(totalsRow.period_total) : 0
      };
    },

    async create(input) {
      const result = await db.query<ExpenseRow>(
        `INSERT INTO fin_expenses (expense_id, expense_date, category, description, amount)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING ${SELECT_COLUMNS}`,
        [input.expenseId, input.expenseDate, input.category, input.description, input.amount]
      );

      const row = result.rows[0];
      if (!row) {
        throw new Error("Expense insert returned no row");
      }

      return mapRow(row);
    },

    async update(expenseId, input) {
      const sets: string[] = [];
      const params: unknown[] = [];

      if (input.expenseDate !== undefined) {
        params.push(input.expenseDate);
        sets.push(`expense_date = $${params.length}`);
      }
      if (input.category !== undefined) {
        params.push(input.category);
        sets.push(`category = $${params.length}`);
      }
      if (input.description !== undefined) {
        params.push(input.description);
        sets.push(`description = $${params.length}`);
      }
      if (input.amount !== undefined) {
        params.push(input.amount);
        sets.push(`amount = $${params.length}`);
      }

      sets.push("updated_at = now()");
      params.push(expenseId);

      const result = await db.query<ExpenseRow>(
        `UPDATE fin_expenses
            SET ${sets.join(", ")}
          WHERE expense_id = $${params.length}
          RETURNING ${SELECT_COLUMNS}`,
        params
      );

      const row = result.rows[0];
      return row ? mapRow(row) : null;
    },

    async remove(expenseId) {
      const result = await db.query("DELETE FROM fin_expenses WHERE expense_id = $1", [expenseId]);
      return (result.rowCount ?? 0) > 0;
    }
  };
}
