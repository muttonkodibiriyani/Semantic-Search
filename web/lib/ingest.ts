import type { IndexedDocument } from "semantic-search-sdk";

/** Stronger recall for product name / title in TF–IDF (repeated terms get higher query match weight). */
const TITLE_WEIGHT = 3;

/** Map a header → value row (e.g. from csv-parse) into an indexed product document. */
export function recordToIndexedDocument(record: Record<string, unknown>, rowIndex: number): IndexedDocument {
  const s = (v: unknown) => (v == null ? "" : String(v).trim());
  const keys = Object.keys(record);
  const get = (...names: string[]) => {
    for (const n of names) {
      const k = keys.find((x) => x.trim().toLowerCase() === n.toLowerCase());
      if (k != null) {
        const v = s(record[k]);
        if (v) return v;
      }
    }
    return "";
  };
  const id =
    get("id", "sku", "product_id", "productid", "item_id", "itemid") ||
    (keys[0] ? s(record[keys[0]!]) : "") ||
    `row-${rowIndex}`;
  const name = get("name", "title", "product", "product_name", "productname");
  const desc = get("description", "desc", "details", "body", "long_description", "longdescription");
  const category = get("category", "type", "brand", "department", "collection");
  const titles = Array(TITLE_WEIGHT).fill(name).filter(Boolean) as string[];
  const text = [...titles, desc, category].filter(Boolean).join("\n");
  const meta: Record<string, string> = {};
  for (const k of keys) {
    const raw = record[k];
    if (raw != null && typeof raw === "object") continue;
    const v = s(raw);
    if (v) meta[k.trim()] = v;
  }
  return { id, text: text || Object.values(meta).join("\n"), meta };
}

/** Minimal CSV parser: handles quoted fields with commas. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      row.push(cur);
      cur = "";
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur);
      cur = "";
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      continue;
    }
    cur += c;
  }
  row.push(cur);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  return rows;
}

export function csvToDocuments(csv: string): IndexedDocument[] {
  const table = parseCsv(csv.trim());
  if (table.length < 2) return [];
  const header = table[0]!;

  const docs: IndexedDocument[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    const record: Record<string, unknown> = {};
    header.forEach((h, i) => {
      record[h.trim()] = cells[i] ?? "";
    });
    docs.push(recordToIndexedDocument(record, r));
  }
  return docs;
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
