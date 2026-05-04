import type { IndexedDocument } from "semantic-search-sdk";
import { parse } from "csv-parse/sync";

/** Stronger recall for product name in TF–IDF. */
const TITLE_WEIGHT = 3;

/** Split PIM "Image Links" cell (URLs separated by comma before next http). */
export function parseImageLinks(raw: string): string[] {
  if (!raw || !String(raw).trim()) return [];
  const s = String(raw).trim();
  const parts = s.split(/,\s*(?=https?:\/\/)/i).map((p) => p.trim().replace(/\?+$/g, ""));
  return parts.filter((p) => /^https?:\/\//i.test(p));
}

function slugifyProductName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function roughMaterialTokens(jsonish: string): string {
  return jsonish
    .replace(/[{}[\]":\d.,%_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Map a header → value row into an indexed product document (PIM / Namshi-style export aware). */
export function recordToIndexedDocument(record: Record<string, unknown>, rowIndex: number): IndexedDocument {
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const keys = Object.keys(record);
  const get = (...names: string[]) => {
    for (const n of names) {
      const want = n.trim().toLowerCase();
      const k = keys.find((x) => x.trim().toLowerCase() === want);
      if (k != null) {
        const v = s(record[k]);
        if (v) return v;
      }
    }
    return "";
  };

  const sku = get("sku (part number)", "sku", "part number");
  const articleNumber = get("article number");
  const styleCode = get("style code");
  const seasonCode = get("season code");
  const pimRowId = get("d", "id");
  const id = sku || articleNumber || pimRowId || `row-${rowIndex}`;

  const name = get("name") || get("name (ar)");
  const nameAr = get("name (ar)");
  const desc = get("long description") || get("long description (ar)");
  const descAr = get("long description (ar)");
  const color = get("hnmdefault~color", "color");
  const size = get("hnmdefault~size", "size");
  const customerGroup = get("hnmdefault~customergroup", "customer group");
  const country = get("country of origin");
  const priceAe = get("price ae");
  const priceSa = get("price sa");
  const composition = get("composition", "im composition");
  const matTokens = composition ? roughMaterialTokens(composition) : "";
  const imagesRaw = get("image links");
  const imageUrls = parseImageLinks(imagesRaw);
  const primaryImage = imageUrls[0] || "";
  const secondarySlice = imageUrls.slice(1, 8);

  const base = process.env.NEXT_PUBLIC_PRODUCT_URL_BASE?.replace(/\/$/, "") || "";
  const slug = slugifyProductName(name || sku || "product");
  const productUrl = base && slug ? `${base}-${slug}` : "";

  const titles = Array(TITLE_WEIGHT).fill(name).filter(Boolean) as string[];
  const text = [
    ...titles,
    nameAr,
    desc,
    descAr,
    styleCode,
    articleNumber,
    sku,
    color,
    size,
    seasonCode,
    customerGroup,
    country,
    priceAe,
    priceSa,
    matTokens,
    imageUrls.length ? `images ${imageUrls.length}` : ""
  ]
    .filter(Boolean)
    .join("\n");

  const meta: Record<string, string> = {};
  for (const k of keys) {
    const raw = record[k];
    if (raw != null && typeof raw === "object") continue;
    const v = s(raw);
    if (v) meta[k.trim()] = v;
  }
  if (primaryImage) meta.primaryImage = primaryImage;
  if (secondarySlice.length) meta.secondaryImages = secondarySlice.join("|");
  if (imageUrls.length) meta.imageCount = String(imageUrls.length);
  if (productUrl) meta.productUrl = productUrl;
  if (styleCode) meta.parentStyleCode = styleCode;
  if (articleNumber) meta.articleNumber = articleNumber;

  return { id, text: text || Object.values(meta).join("\n"), meta };
}

/** Robust CSV → rows (handles quoted fields with JSON/commas inside). */
export function csvToDocuments(csv: string): IndexedDocument[] {
  const records = parse(csv, {
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    quote: '"',
    escape: '"',
    relax_quotes: true
  }) as Record<string, unknown>[];
  return records.map((row, i) => recordToIndexedDocument(row, i + 1));
}

export function jsonToDocuments(raw: string): IndexedDocument[] {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) return [];
  const docs: IndexedDocument[] = [];
  let i = 0;
  for (const item of data) {
    i++;
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    docs.push(recordToIndexedDocument(o, i));
  }
  return docs;
}
