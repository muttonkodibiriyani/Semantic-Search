import { parse } from "csv-parse/sync";
import type { ProductDocument } from "./product-engine";
import { deriveFacets } from "./product-facets";

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

/**
 * Map one PIM-style row into a `ProductDocument` with separate title /
 * description / attributes fields and pre-derived structured facets
 * (gender / category / color / price). The new BM25 ranker uses these.
 */
export function recordToProductDocument(record: Record<string, unknown>, rowIndex: number): ProductDocument {
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
  const desc = get("long description");
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

  // Build the three field bags. Title gets the strongest weight in BM25 so we
  // *do not* pad it with non-name content.
  const title = [name, nameAr].filter(Boolean).join(" — ");
  const description = [desc, descAr].filter(Boolean).join("\n");
  const attributes = [
    color,
    size,
    customerGroup,
    country,
    seasonCode,
    styleCode,
    articleNumber,
    sku,
    priceAe ? `price ${priceAe} aed` : "",
    priceSa ? `price ${priceSa} sar` : "",
    matTokens
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

  const facets = deriveFacets(record, name);
  if (facets.gender) meta._facet_gender = facets.gender;
  if (facets.category) meta._facet_category = facets.category;
  if (facets.color) meta._facet_color = facets.color;
  if (facets.customerGroup) meta._facet_customerGroup = facets.customerGroup;
  if (facets.price != null) meta._facet_price = String(facets.price);

  return {
    id,
    title: title || sku || `row-${rowIndex}`,
    description,
    attributes,
    meta,
    gender: facets.gender,
    category: facets.category,
    color: facets.color,
    customerGroup: facets.customerGroup,
    price: facets.price,
    primaryImage: primaryImage || undefined,
    productUrl: productUrl || undefined,
    styleCode: styleCode || undefined,
    articleNumber: articleNumber || undefined
  };
}

/** Robust CSV → product rows (handles quoted fields with JSON/commas inside). */
export function csvToDocuments(csv: string): ProductDocument[] {
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
  return records.map((row, i) => recordToProductDocument(row, i + 1));
}

export function jsonToDocuments(raw: string): ProductDocument[] {
  const data = JSON.parse(raw) as unknown;
  if (!Array.isArray(data)) return [];
  const docs: ProductDocument[] = [];
  let i = 0;
  for (const item of data) {
    i++;
    if (item == null || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    docs.push(recordToProductDocument(o, i));
  }
  return docs;
}
