import { createReadStream } from "fs";
import { readFile, stat } from "fs/promises";
import { createInterface } from "readline";
import { parse } from "csv-parse";
import type { SemanticSearchEngine } from "semantic-search-sdk";
import { jsonToDocuments, recordToIndexedDocument } from "./ingest";

const BATCH = 8000;
/** Single JSON array uploads above this size must use JSON Lines (.jsonl) instead. */
const MAX_WHOLE_JSON_BYTES = 80 * 1024 * 1024;

function getMaxRows(): number | undefined {
  const v = process.env.SEMANTIC_SEARCH_MAX_ROWS;
  if (v == null || v === "") return undefined;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function delimiterForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".tsv")) return "\t";
  return ",";
}

async function indexCsvStream(
  filePath: string,
  filename: string,
  engine: SemanticSearchEngine,
  maxRows: number | undefined,
  onProgress?: (indexed: number) => void
): Promise<{ indexed: number; truncated: boolean }> {
  const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
  const parser = stream.pipe(
    parse({
      columns: true,
      relax_column_count: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
      quote: '"',
      escape: '"',
      relax_quotes: true,
      delimiter: delimiterForFilename(filename)
    })
  );

  let indexed = 0;
  let truncated = false;
  const batch: ReturnType<typeof recordToIndexedDocument>[] = [];

  for await (const row of parser) {
    if (maxRows != null && indexed >= maxRows) {
      truncated = true;
      break;
    }
    const record = row as Record<string, unknown>;
    batch.push(recordToIndexedDocument(record, indexed + 1));
    indexed++;
    if (batch.length >= BATCH) {
      engine.appendBatch(batch);
      batch.length = 0;
      onProgress?.(indexed);
    }
  }
  if (batch.length) engine.appendBatch(batch);
  onProgress?.(indexed);
  return { indexed, truncated };
}

async function indexJsonlStream(
  filePath: string,
  engine: SemanticSearchEngine,
  maxRows: number | undefined,
  onProgress?: (indexed: number) => void
): Promise<{ indexed: number; truncated: boolean }> {
  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 }),
    crlfDelay: Infinity
  });

  let indexed = 0;
  let truncated = false;
  const batch: ReturnType<typeof recordToIndexedDocument>[] = [];

  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    if (maxRows != null && indexed >= maxRows) {
      truncated = true;
      break;
    }
    let o: unknown;
    try {
      o = JSON.parse(t) as unknown;
    } catch {
      continue;
    }
    if (o == null || typeof o !== "object") continue;
    batch.push(recordToIndexedDocument(o as Record<string, unknown>, indexed + 1));
    indexed++;
    if (batch.length >= BATCH) {
      engine.appendBatch(batch);
      batch.length = 0;
      onProgress?.(indexed);
    }
  }
  if (batch.length) engine.appendBatch(batch);
  onProgress?.(indexed);
  return { indexed, truncated };
}

/**
 * Stream a large uploaded file into the search engine (does not load whole file into RAM).
 */
export async function indexFromUploadedFile(
  filePath: string,
  filename: string,
  engine: SemanticSearchEngine,
  onProgress?: (indexed: number) => void
): Promise<{ indexed: number; truncated: boolean; warning?: string }> {
  const maxRows = getMaxRows();
  const lower = filename.toLowerCase();
  const st = await stat(filePath);

  engine.beginReplace();

  try {
    if (lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
      const { indexed, truncated } = await indexJsonlStream(filePath, engine, maxRows, onProgress);
      engine.finalizeReplace();
      return {
        indexed,
        truncated,
        warning: truncated ? `Stopped at ${maxRows} rows (SEMANTIC_SEARCH_MAX_ROWS).` : undefined
      };
    }

    if (lower.endsWith(".json")) {
      if (st.size > MAX_WHOLE_JSON_BYTES) {
        throw new Error(
          `JSON file is ${Math.round(st.size / (1024 * 1024))}MB. For large catalogs use JSON Lines (.jsonl): one JSON object per line, then upload again.`
        );
      }
      const raw = await readFile(filePath, "utf8");
      const docs = jsonToDocuments(raw);
      let slice = docs;
      if (maxRows != null && docs.length > maxRows) {
        slice = docs.slice(0, maxRows);
        engine.appendBatch(slice);
        engine.finalizeReplace();
        return {
          indexed: slice.length,
          truncated: true,
          warning: `Stopped at ${maxRows} rows (SEMANTIC_SEARCH_MAX_ROWS).`
        };
      }
      engine.appendBatch(slice);
      engine.finalizeReplace();
      return { indexed: slice.length, truncated: false };
    }

    const { indexed, truncated } = await indexCsvStream(filePath, filename, engine, maxRows, onProgress);
    engine.finalizeReplace();
    return {
      indexed,
      truncated,
      warning: truncated ? `Stopped at ${maxRows} rows (SEMANTIC_SEARCH_MAX_ROWS).` : undefined
    };
  } catch (e) {
    engine.beginReplace();
    engine.finalizeReplace();
    throw e;
  }
}
