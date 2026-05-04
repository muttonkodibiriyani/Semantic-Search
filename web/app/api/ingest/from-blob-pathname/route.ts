import { Readable } from "stream";
import { NextResponse } from "next/server";
import { head, list } from "@vercel/blob";
import { indexFromCsvStream } from "@/lib/ingest-file";
import { enqueueIngest } from "@/lib/ingest-queue";
import { getEngine } from "@/lib/engine-store";
import { saveSnapshotToBlob, markEngineHydrated, SNAPSHOT_PATHNAME } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = { pathname?: string };

/**
 * Ingest a CSV that is **already** uploaded to this project's Vercel Blob store,
 * by its `pathname` (e.g. `pim_namshi_report_03-10-2025_06-46-05.csv`). Avoids
 * re-uploading huge files through the browser when the file is already in Blob.
 */
export async function POST(req: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "BLOB_READ_WRITE_TOKEN is not configured on the server." },
      { status: 500 }
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON with `pathname`." }, { status: 400 });
  }
  const pathname = typeof body.pathname === "string" ? body.pathname.trim() : "";
  if (!pathname) {
    return NextResponse.json({ error: "`pathname` is required." }, { status: 400 });
  }
  if (pathname === SNAPSHOT_PATHNAME) {
    return NextResponse.json({ error: "Cannot ingest the index snapshot itself." }, { status: 400 });
  }
  const lower = pathname.toLowerCase();
  if (!lower.endsWith(".csv") && !lower.endsWith(".tsv")) {
    return NextResponse.json(
      { error: "Only .csv or .tsv blobs are supported via this endpoint right now." },
      { status: 400 }
    );
  }

  let url: string;
  try {
    const meta = await head(pathname, { token });
    url = meta.url;
  } catch {
    // Fall back to listing in case the caller passed only a prefix.
    const listed = await list({ prefix: pathname, token, limit: 1 });
    if (!listed.blobs.length) {
      return NextResponse.json({ error: `No blob found at "${pathname}".` }, { status: 404 });
    }
    url = listed.blobs[0].url;
  }

  const headers: Record<string, string> = {};
  if (new URL(url).hostname.toLowerCase().endsWith(".private.blob.vercel-storage.com")) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url, { headers, cache: "no-store" });
  if (!res.ok || !res.body) {
    return NextResponse.json(
      { error: `Download failed (${res.status}). Check the blob and the token.` },
      { status: 400 }
    );
  }
  const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
  const filename = pathname.split("/").pop() || "catalog.csv";

  try {
    const summary = await enqueueIngest(async () => {
      const engine = getEngine();
      return indexFromCsvStream(nodeStream, filename, engine);
    });

    let snapshot: { url: string; size: number } | null = null;
    let snapshotWarning: string | undefined;
    try {
      const engine = getEngine();
      snapshot = await saveSnapshotToBlob(engine.getDocuments());
      markEngineHydrated();
    } catch (e) {
      const message = e instanceof Error ? e.message : "snapshot failed";
      snapshotWarning = `Index built in memory, but persisting snapshot to Blob failed: ${message}. The index will only be available on this lambda; use POST /api/admin/free-blob to delete the source CSV from Blob and free space, then re-ingest to enable cross-lambda search.`;
    }

    return NextResponse.json({
      ok: true,
      indexed: summary.indexed,
      truncated: summary.truncated,
      warning: [summary.warning, snapshotWarning].filter(Boolean).join(" ").trim() || undefined,
      snapshot: snapshot ? { url: snapshot.url, sizeBytes: snapshot.size } : null
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
