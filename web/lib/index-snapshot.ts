import type { IndexedDocument } from "semantic-search-sdk";
import { head, put, del } from "@vercel/blob";
import { getEngine } from "@/lib/engine-store";

/**
 * Stable Blob pathname under which we persist the in-memory index so the
 * search lambda can hydrate the engine on a cold start (in-memory state in
 * `globalThis` is per-instance only on Vercel).
 */
export const SNAPSHOT_PATHNAME = "_semantic-search/index-snapshot.json";

const g = globalThis as unknown as {
  __semanticSearchHydrating?: Promise<number>;
  __semanticSearchHydrated?: boolean;
};

type SnapshotPayload = {
  v: 1;
  createdAt: string;
  documents: IndexedDocument[];
};

function blobToken(): string | undefined {
  return process.env.BLOB_READ_WRITE_TOKEN;
}

export async function saveSnapshotToBlob(documents: IndexedDocument[]): Promise<string | null> {
  const token = blobToken();
  if (!token) return null;
  const payload: SnapshotPayload = {
    v: 1,
    createdAt: new Date().toISOString(),
    documents
  };
  const body = JSON.stringify(payload);
  const r = await put(SNAPSHOT_PATHNAME, body, {
    access: "public",
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
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) {
        g.__semanticSearchHydrated = true;
        return 0;
      }
      const data = (await res.json()) as SnapshotPayload;
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
