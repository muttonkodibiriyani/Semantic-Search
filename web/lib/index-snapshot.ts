import { head, put, del } from "@vercel/blob";
import type { ProductDocument } from "./product-engine";
import { getEngine } from "./engine-store";

/**
 * Stable Blob pathname under which we persist the in-memory index so the
 * search lambda can hydrate the engine on a cold start (in-memory state in
 * `globalThis` is per-instance only on Vercel).
 *
 * v2 snapshots include the structured product document shape used by the
 * BM25 + facet-filter engine. v1 snapshots (TF-IDF era) are ignored — a
 * fresh ingest will overwrite them.
 */
export const SNAPSHOT_PATHNAME = "_semantic-search/index-snapshot.json";

const g = globalThis as unknown as {
  __semanticSearchHydrating?: Promise<number>;
  __semanticSearchHydrated?: boolean;
};

type SnapshotPayloadV2 = {
  v: 2;
  createdAt: string;
  documents: ProductDocument[];
};

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

function snapshotAccess(): "public" | "private" {
  const v = (process.env.BLOB_STORE_ACCESS || "private").toLowerCase();
  return v === "public" ? "public" : "private";
}

export async function saveSnapshotToBlob(documents: ProductDocument[]): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  const payload: SnapshotPayloadV2 = {
    v: 2,
    createdAt: new Date().toISOString(),
    documents
  };
  const body = JSON.stringify(payload);
  const r = await put(SNAPSHOT_PATHNAME, body, {
    access: snapshotAccess(),
    contentType: "application/json",
    token,
    allowOverwrite: true,
    addRandomSuffix: false,
    cacheControlMaxAge: 0
  });
  return r.url;
}

export async function deleteSnapshotFromBlob(): Promise<void> {
  const token = blobToken();
  if (!token) return;
  try {
    await del(SNAPSHOT_PATHNAME, { token });
  } catch {
    /* missing is fine */
  }
}

export async function hydrateEngineFromBlob(): Promise<number> {
  const token = blobToken();
  if (!token) return 0;
  const engine = getEngine();
  if (engine.documentCount > 0 || g.__semanticSearchHydrated) return engine.documentCount;
  if (g.__semanticSearchHydrating) return g.__semanticSearchHydrating;

  g.__semanticSearchHydrating = (async () => {
    try {
      let url: string;
      try {
        const meta = await head(SNAPSHOT_PATHNAME, { token });
        url = meta.url;
      } catch {
        g.__semanticSearchHydrated = true;
        return 0;
      }
      const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
      const res = await fetch(url, { cache: "no-store", headers });
      if (!res.ok) {
        g.__semanticSearchHydrated = true;
        return 0;
      }
      const data = (await res.json()) as Partial<SnapshotPayloadV2> & { v?: number };
      if (data?.v !== 2) {
        // Old TF-IDF snapshot — incompatible with the BM25 engine. Ignore;
        // the next ingest will overwrite it.
        g.__semanticSearchHydrated = true;
        return 0;
      }
      const docs = Array.isArray(data?.documents) ? data.documents : [];
      if (docs.length === 0) {
        g.__semanticSearchHydrated = true;
        return 0;
      }
      engine.replaceDocuments(docs);
      g.__semanticSearchHydrated = true;
      return engine.documentCount;
    } finally {
      g.__semanticSearchHydrating = undefined;
    }
  })();

  return g.__semanticSearchHydrating;
}

export function markEngineHydrated(): void {
  g.__semanticSearchHydrated = true;
}
