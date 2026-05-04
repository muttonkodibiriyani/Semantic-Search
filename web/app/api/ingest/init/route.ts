import { NextResponse } from "next/server";
import { createUploadSession } from "@/lib/upload-sessions";

export const runtime = "nodejs";

type Body = { filename?: string; totalBytes?: number; totalChunks?: number };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON body." }, { status: 400 });
  }
  const filename = typeof body.filename === "string" ? body.filename : "";
  const totalBytes = Number(body.totalBytes);
  const totalChunks = Number(body.totalChunks);
  if (!filename || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return NextResponse.json({ error: "filename and positive totalBytes are required." }, { status: 400 });
  }
  if (!Number.isFinite(totalChunks) || totalChunks < 1 || totalChunks > 500_000) {
    return NextResponse.json({ error: "totalChunks must be between 1 and 500000." }, { status: 400 });
  }
  try {
    const { uploadId } = await createUploadSession(filename, totalBytes, totalChunks);
    return NextResponse.json({ uploadId, totalBytes, totalChunks });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to start upload";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
