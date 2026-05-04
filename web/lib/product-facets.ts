import { CATEGORY_TAXONOMY, COLOR_VOCAB, type Gender } from "./query-understanding";

export type ProductFacets = {
  gender?: Gender;
  /** Canonical category key from CATEGORY_TAXONOMY. */
  category?: string;
  /** Canonical color name (lowercased single token). */
  color?: string;
  /** Raw customer-group string from PIM (kept for display). */
  customerGroup?: string;
  /** Numeric price (lowest currency seen on the row, or undefined). */
  price?: number;
};

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function genderFromCustomerGroup(raw: string): Gender | undefined {
  const v = raw.toLowerCase();
  if (!v) return undefined;
  if (v.includes("girl")) return "girl";
  if (v.includes("boy")) return "boy";
  if (v.includes("women") || v.includes("ladies") || v.includes("female") || v.includes("woman")) return "women";
  if (v.includes("men") || v.includes("male") || v.includes("man")) return "men";
  if (v.includes("unisex") || v.includes("all")) return "unisex";
  return undefined;
}

function categoryFromText(text: string): string | undefined {
  if (!text) return undefined;
  const lower = text.toLowerCase();
  let bestKey: string | undefined;
  let bestWord = "";
  for (const [key, { words }] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const w of words) {
      const pattern = w.includes(" ") || w.includes("-")
        ? `\\b${escapeRegex(w).replace(/[-\\\\\s]+/g, "[-\\s]+")}\\b`
        : `\\b${escapeRegex(w)}\\b`;
      const re = new RegExp(pattern, "i");
      if (re.test(lower)) {
        if (w.length > bestWord.length) {
          bestKey = key;
          bestWord = w;
        }
      }
    }
  }
  return bestKey;
}

function colorFromValue(raw: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  for (const c of COLOR_VOCAB) {
    const pattern = c.includes(" ")
      ? `\\b${escapeRegex(c).replace(/\s+/g, "\\s+")}\\b`
      : `\\b${escapeRegex(c)}\\b`;
    if (new RegExp(pattern, "i").test(lower)) {
      return c.split(/\s+/).pop();
    }
  }
  // Fall back to the first token of the raw color cell so PIM-only colors
  // (e.g. "FUCHSIA", "AQUA") are still searchable as exact strings.
  const tok = lower.split(/[\s,/]+/).filter(Boolean)[0];
  return tok || undefined;
}

function priceFromValues(values: string[]): number | undefined {
  for (const v of values) {
    if (!v) continue;
    const n = parseFloat(String(v).replace(/[^\d.]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

/**
 * Pull a value from a record by case-insensitive header match. Headers in PIM
 * exports are unstable so we accept several aliases per logical field.
 */
function pickField(record: Record<string, unknown>, ...names: string[]): string {
  const keys = Object.keys(record);
  for (const n of names) {
    const want = n.trim().toLowerCase();
    const k = keys.find((x) => x.trim().toLowerCase() === want);
    if (k != null) {
      const v = record[k];
      if (v != null && String(v).trim() !== "") return String(v).trim();
    }
  }
  return "";
}

/**
 * Derive structured retrieval facets (gender, category, color, price) for one
 * product row. Used to enable hard facet-filtering at search time.
 */
export function deriveFacets(
  record: Record<string, unknown>,
  fallbackName: string
): ProductFacets {
  const customerGroup = pickField(record, "HNMDefault~customerGroup", "customer group", "customerGroup");
  const colorRaw = pickField(record, "HNMDefault~color", "color");
  const name = fallbackName || pickField(record, "name", "name (en)", "product name");
  const desc = pickField(record, "long description", "description");
  const priceAe = pickField(record, "price ae", "priceae", "price_ae");
  const priceSa = pickField(record, "price sa", "pricesa", "price_sa");
  const price = priceFromValues([priceAe, priceSa]);

  const gender = genderFromCustomerGroup(customerGroup);
  const category = categoryFromText(name) || categoryFromText(desc);
  const color = colorFromValue(colorRaw);

  return {
    gender,
    category,
    color,
    customerGroup: customerGroup || undefined,
    price
  };
}
