import { Readable } from "stream";
import { NextResponse } from "next/server";
import { indexFromCsvStream } from "@/lib/ingest-file";
import { enqueueIngest } from "@/lib/ingest-queue";
import { getEngine } from "@/lib/engine-store";
import { saveSnapshotToBlob, markEngineHydrated } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = { url?: string; filename?: string };

function assertSafeBlobUrl(urlStr: string): void {
  let u: URL;
  try {
    u = new URL(urlStr);
  } catch {
    throw new Error("Invalid URL.");
  }
  const h = u.hostname.toLowerCase();
  // `<store>.private.blob.vercel-storage.com` and `<store>.public.blob.vercel-storage.com`
  // both end with `.blob.vercel-storage.com`, which is the only suffix we accept.
  if (!h.endsWith(".blob.vercel-storage.com")) {
    throw new Error("Only Vercel Blob URLs are allowed (SSRF protection).");
  }
}

function isPrivateBlob(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return u.hostname.toLowerCase().endsWith(".private.blob.vercel-storage.com");
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON with url and filename." }, { status: 400 });
  }
  const url = typeof body.url === "string" ? body.url.trim() : "";
  const filename = typeof body.filename === "string" ? body.filename.trim() : "catalog.csv";
  if (!url) {
    return NextResponse.json({ error: "url is required." }, { status: 400 });
  }
  try {
    assertSafeBlobUrl(url);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Bad URL";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const headers: Record<string, string> = {};
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
  if (isPrivateBlob(url)) {
    if (!blobToken) {
      return NextResponse.json(
        {
          error:
            "This blob is private but BLOB_READ_WRITE_TOKEN is not configured for the function. Make the blob public or set the token."
        },
        { status: 500 }
      );
    }
    headers.Authorization = `Bearer ${blobToken}`;
  }

  try {
    const res = await fetch(url, { headers, cache: "no-store" });
    if (!res.ok || !res.body) {
      return NextResponse.json(
        { error: `Download failed (${res.status}). Verify the blob URL and BLOB_READ_WRITE_TOKEN.` },
        { status: 400 }
      );
    }
    const lower = filename.toLowerCase();
    if (lower.endsWith(".json") || lower.endsWith(".jsonl") || lower.endsWith(".ndjson")) {
      return NextResponse.json(
        {
          error:
            "Streaming JSON/JSONL ingest from Blob is not supported on Vercel yet (only CSV/TSV). Convert to CSV or upload a smaller .json directly."
        },
        { status: 400 }
      );
    }

    const nodeStream = Readable.fromWeb(res.body as import("stream/web").ReadableStream);
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
      snapshotWarning = `Index built in memory, but persisting to Blob failed: ${message}. Search may only work on this lambda until snapshot persistence is restored.`;
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
