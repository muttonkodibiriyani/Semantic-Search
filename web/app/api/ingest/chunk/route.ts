import { NextResponse } from "next/server";
import { appendChunk } from "@/lib/upload-sessions";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const uploadId = req.headers.get("x-upload-id")?.trim();
  const chunkRaw = req.headers.get("x-chunk-index");
  if (!uploadId || chunkRaw == null) {
    return NextResponse.json(
      { error: "Headers x-upload-id and x-chunk-index are required." },
      { status: 400 }
    );
  }
  const chunkIndex = parseInt(chunkRaw, 10);
  if (!Number.isFinite(chunkIndex) || chunkIndex < 0) {
    return NextResponse.json({ error: "Invalid x-chunk-index." }, { status: 400 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0) {
    return NextResponse.json({ error: "Empty chunk body." }, { status: 400 });
  }
  const result = await appendChunk(uploadId, chunkIndex, buf);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    received: result.received,
    nextChunk: result.nextChunk
  });
}
