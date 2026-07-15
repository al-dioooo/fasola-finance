// Dashboard-side view + serialization of per-variant pricing. Storage format
// mirrors the bot (fasola-order-bot/src/modules/products/variant-pricing.ts) and
// is documented in the bot repo's docs/db-contract.md:
//   variants_json           -> flat name list (unchanged; every bot reader uses it)
//   variant_pricing_json    -> {"selection":{"min","max"},
//                               "options":{"<name>":{"priceDelta","inStock"}}}
// The dashboard owns variant_pricing_json; the bot only reads it. We expose a
// UI-friendly VariantConfig (one option per name, merged with its pricing) and
// convert back to the stored columns on write.

// UI/API shape: one option per variant, plus the group's selection rule.
export interface VariantOption {
  name: string;
  priceDelta: number;
  inStock: boolean;
}

export interface VariantConfig {
  // required = GoBiz min_quantity >= 1 (customer must pick); false = optional.
  required: boolean;
  // How many options a customer may pick (GoBiz max_quantity).
  maxSelectable: number;
  options: VariantOption[];
}

interface StoredVariantPricing {
  selection: { min: number; max: number };
  options: Record<string, { priceDelta: number; inStock: boolean }>;
}

function isFiniteInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function parseStored(json: string | null): StoredVariantPricing | null {
  if (!json) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const selectionRaw = record.selection as Record<string, unknown> | undefined;
  const min = isFiniteInt(selectionRaw?.min) ? Math.max(0, selectionRaw.min) : 1;
  const max = Math.max(1, isFiniteInt(selectionRaw?.max) ? selectionRaw.max : 1, min);

  const options: StoredVariantPricing["options"] = {};
  const optionsRaw = record.options;
  if (typeof optionsRaw === "object" && optionsRaw !== null) {
    for (const [name, value] of Object.entries(optionsRaw as Record<string, unknown>)) {
      const option = value as Record<string, unknown> | null;
      options[name] = {
        priceDelta: isFiniteInt(option?.priceDelta) ? option.priceDelta : 0,
        inStock: typeof option?.inStock === "boolean" ? option.inStock : true
      };
    }
  }
  return { selection: { min, max }, options };
}

// Merge the flat name list with stored pricing into the UI config. Names with no
// stored entry (e.g. added via WhatsApp /menu) default to zero delta / in stock.
export function buildVariantConfig(names: string[], pricingJson: string | null): VariantConfig {
  const stored = parseStored(pricingJson);
  return {
    required: stored ? stored.selection.min >= 1 : true,
    maxSelectable: stored ? stored.selection.max : 1,
    options: names.map((name) => {
      const option = stored?.options[name];
      return {
        name,
        priceDelta: option?.priceDelta ?? 0,
        inStock: option?.inStock ?? true
      };
    })
  };
}

// Convert an incoming VariantConfig into the two stored columns. Names are
// trimmed + de-duplicated (keeping first occurrence) so variants_json stays the
// clean name list the bot expects. Returns pricingJson=null when the config
// carries no custom pricing (all zero deltas, all in stock, required
// single-select) — that's exactly the builder's default, so we keep the column
// clear instead of persisting a redundant object.
export function serializeVariantConfig(config: VariantConfig): {
  names: string[];
  pricingJson: string | null;
} {
  const names: string[] = [];
  const options: StoredVariantPricing["options"] = {};
  for (const option of config.options) {
    const name = option.name.trim();
    if (!name || Object.prototype.hasOwnProperty.call(options, name)) {
      continue;
    }
    const priceDelta = Number.isInteger(option.priceDelta) ? option.priceDelta : 0;
    const inStock = option.inStock !== false;
    names.push(name);
    options[name] = { priceDelta, inStock };
  }

  if (names.length === 0) {
    return { names: [], pricingJson: null };
  }

  const max = Math.max(1, Math.floor(config.maxSelectable) || 1);
  const isDefault =
    config.required &&
    max === 1 &&
    names.every((name) => options[name]?.priceDelta === 0 && options[name]?.inStock === true);
  if (isDefault) {
    return { names, pricingJson: null };
  }

  const stored: StoredVariantPricing = {
    selection: { min: config.required ? 1 : 0, max },
    options
  };
  return { names, pricingJson: JSON.stringify(stored) };
}
