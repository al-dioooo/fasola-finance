import type { Db } from "../server/src/db/client.js";
import { connect, fail, resolveTarget } from "./db-target.js";
import {
  businessDateDaysAgo,
  buildExpenseId,
  isoUtcNow,
  seedBusinessProfile,
  seedExpenses,
  seedGofoodSettings,
  seedProducts,
  toProductRowValues
} from "./seed-data.js";

// Writes the seed dataset into an already-migrated local database. Every write
// is an upsert on a deterministic id, so this is re-runnable on its own (no
// reset needed) and never accumulates duplicates. Rows it does not own — e.g. a
// product you added by hand — are left alone and reported at the end.

async function main(): Promise<void> {
  const target = resolveTarget();
  const db = connect(target);

  try {
    await assertSchemaReady(db);

    console.log(`\nSeeding: ${target.label}`);

    const products = await seedProductRows(db);
    const profile = await seedProfileRows(db);
    const gofood = await seedGofoodRows(db);
    const expenses = await seedExpenseRows(db);

    console.log(`\n  products          ${products} row(s)`);
    console.log(`  business_profile  ${profile} row(s)`);
    console.log(`  gofood_settings   ${gofood} row(s)`);
    console.log(`  fin_expenses      ${expenses} row(s)`);

    await reportUnseeded(db);

    console.log("\nDone.\n");
  } finally {
    await db.end();
  }
}

async function assertSchemaReady(db: Db): Promise<void> {
  const result = await db.query<{ missing: string }>(
    `SELECT t.name AS missing
     FROM (VALUES ('products'), ('business_profile'), ('gofood_settings'), ('fin_expenses'))
       AS t(name)
     WHERE to_regclass('public.' || t.name) IS NULL`
  );

  if (result.rows.length > 0) {
    const missing = result.rows.map((row) => row.missing).join(", ");
    throw new Error(
      `Database is missing table(s): ${missing}\n\nRun \`npm run db:reset\` first to build the schema.`
    );
  }
}

async function seedProductRows(db: Db): Promise<number> {
  const now = isoUtcNow();
  let written = 0;

  for (const product of seedProducts) {
    const row = toProductRowValues(product);

    // image_url is intentionally absent: it is set by the upload flow and a
    // reseed should not clobber a photo you attached while testing.
    await db.query(
      `INSERT INTO products (
         product_id, product_name, aliases_json, category, price, stock_status,
         is_available, variants_json, notes, description, stock_quantity,
         variant_pricing_json, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT (product_id) DO UPDATE SET
         product_name = EXCLUDED.product_name,
         aliases_json = EXCLUDED.aliases_json,
         category = EXCLUDED.category,
         price = EXCLUDED.price,
         stock_status = EXCLUDED.stock_status,
         is_available = EXCLUDED.is_available,
         variants_json = EXCLUDED.variants_json,
         notes = EXCLUDED.notes,
         description = EXCLUDED.description,
         stock_quantity = EXCLUDED.stock_quantity,
         variant_pricing_json = EXCLUDED.variant_pricing_json,
         updated_at = EXCLUDED.updated_at`,
      [
        row.productId,
        row.productName,
        row.aliasesJson,
        row.category,
        row.price,
        row.stockStatus,
        row.isAvailable,
        row.variantsJson,
        row.notes,
        row.description,
        row.stockQuantity,
        row.variantPricingJson,
        now
      ]
    );
    written += 1;
  }

  return written;
}

async function seedProfileRows(db: Db): Promise<number> {
  const now = isoUtcNow();
  let written = 0;

  for (const [key, value] of Object.entries(seedBusinessProfile)) {
    await db.query(
      `INSERT INTO business_profile (profile_key, profile_value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (profile_key) DO UPDATE SET
         profile_value = EXCLUDED.profile_value,
         updated_at = EXCLUDED.updated_at`,
      [key, value, now]
    );
    written += 1;
  }

  return written;
}

async function seedGofoodRows(db: Db): Promise<number> {
  const now = isoUtcNow();
  let written = 0;

  for (const [key, value] of Object.entries(seedGofoodSettings)) {
    await db.query(
      `INSERT INTO gofood_settings (config_key, config_value, updated_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (config_key) DO UPDATE SET
         config_value = EXCLUDED.config_value,
         updated_at = EXCLUDED.updated_at`,
      [key, value, now]
    );
    written += 1;
  }

  return written;
}

async function seedExpenseRows(db: Db): Promise<number> {
  let written = 0;

  for (const [index, expense] of seedExpenses.entries()) {
    const expenseDate = businessDateDaysAgo(expense.daysAgo);
    await db.query(
      `INSERT INTO fin_expenses (expense_id, expense_date, category, description, amount)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (expense_id) DO UPDATE SET
         expense_date = EXCLUDED.expense_date,
         category = EXCLUDED.category,
         description = EXCLUDED.description,
         amount = EXCLUDED.amount,
         updated_at = now()`,
      [
        buildExpenseId(expenseDate, index),
        expenseDate,
        expense.category,
        expense.description,
        expense.amount
      ]
    );
    written += 1;
  }

  return written;
}

// The seeder only owns the ids it writes. Anything else in these tables
// survives a re-seed, which is usually what you want mid-debugging — but it
// should not be a surprise.
async function reportUnseeded(db: Db): Promise<void> {
  const productIds = seedProducts.map((product) => product.productId);
  const extraProducts = await db.query<{ count: string }>(
    "SELECT count(*) AS count FROM products WHERE NOT (product_id = ANY($1))",
    [productIds]
  );
  const extraExpenses = await db.query<{ count: string }>(
    "SELECT count(*) AS count FROM fin_expenses WHERE expense_id NOT LIKE 'EXP-%-SEED%'"
  );
  const orders = await db.query<{ count: string }>("SELECT count(*) AS count FROM orders");

  const notes: string[] = [];
  const extraProductCount = Number(extraProducts.rows[0]?.count ?? 0);
  const extraExpenseCount = Number(extraExpenses.rows[0]?.count ?? 0);
  const orderCount = Number(orders.rows[0]?.count ?? 0);

  if (extraProductCount > 0) {
    notes.push(`${extraProductCount} non-seed product(s) left untouched`);
  }
  if (extraExpenseCount > 0) {
    notes.push(`${extraExpenseCount} non-seed expense(s) left untouched`);
  }
  if (orderCount === 0) {
    notes.push("orders is empty — reports and the order list will render with no data");
  }

  if (notes.length > 0) {
    console.log("");
    for (const note of notes) {
      console.log(`  note: ${note}`);
    }
  }
}

try {
  await main();
} catch (error) {
  fail(error);
}
