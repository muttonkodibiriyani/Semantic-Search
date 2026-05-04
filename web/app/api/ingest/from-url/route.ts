import { randomUUID } from "crypto";
import { createWriteStream } from "fs";
import { unlink } from "fs/promises";
import path from "path";
import os from "os";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { NextResponse } from "next/server";
import { indexFromUploadedFile } from "@/lib/ingest-file";
import { enqueueIngest } from "@/lib/ingest-queue";
import { getEngine } from "@/lib/engine-store";

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
  if (!h.endsWith(".blob.vercel-storage.com") && !h.endsWith(".public.blob.vercel-storage.com")) {
    throw new Error("Only Vercel Blob URLs are allowed (SSRF protection).");
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

  const id = randomUUID();
  const filePath = path.join(os.tmpdir(), `semantic-search-blob-${id}.upload`);

  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: `Download failed (${res.status}).` }, { status: 400 });
    }
    const webBody = res.body;
    await pipeline(Readable.fromWeb(webBody as import("stream/web").ReadableStream), createWriteStream(filePath));

    const summary = await enqueueIngest(async () => {
      const engine = getEngine();
      return indexFromUploadedFile(filePath, filename, engine);
    });

    return NextResponse.json({
      ok: true,
      indexed: summary.indexed,
      truncated: summary.truncated,
      warning: summary.warning
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  } finally {
    await unlink(filePath).catch(() => {});
  }
}
