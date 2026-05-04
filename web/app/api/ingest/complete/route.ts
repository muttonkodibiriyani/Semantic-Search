import { NextResponse } from "next/server";
import { indexFromUploadedFile } from "@/lib/ingest-file";
import { enqueueIngest } from "@/lib/ingest-queue";
import { getEngine } from "@/lib/engine-store";
import { removeSession, verifyUploadComplete } from "@/lib/upload-sessions";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

type Body = { uploadId?: string };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON body with uploadId." }, { status: 400 });
  }
  const uploadId = typeof body.uploadId === "string" ? body.uploadId.trim() : "";
  if (!uploadId) {
    return NextResponse.json({ error: "uploadId is required." }, { status: 400 });
  }

  const verified = await verifyUploadComplete(uploadId);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 400 });
  }

  const { session } = verified;
  const filePath = session.filePath;
  const filename = session.filename;

  try {
    const summary = await enqueueIngest(async () => {
      const engine = getEngine();
      return indexFromUploadedFile(filePath, filename, engine);
    });
    await removeSession(uploadId);
    return NextResponse.json({
      ok: true,
      indexed: summary.indexed,
      truncated: summary.truncated,
      warning: summary.warning
    });
  } catch (e) {
    await removeSession(uploadId);
    const message = e instanceof Error ? e.message : "Indexing failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
