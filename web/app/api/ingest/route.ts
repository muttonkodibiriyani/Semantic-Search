import { NextResponse } from "next/server";
import { csvToDocuments, jsonToDocuments } from "@/lib/ingest";
import { getEngine } from "@/lib/engine-store";
import { saveSnapshotToBlob, markEngineHydrated } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Above this size the UI must use chunked upload (init → chunk → complete). */
const MAX_SINGLE_REQUEST_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing file field (multipart form)." }, { status: 400 });
  }
  if (file.size > MAX_SINGLE_REQUEST_BYTES) {
    return NextResponse.json(
      {
        error: `File is ${Math.round(file.size / (1024 * 1024))}MB. Use the app’s large-file upload (chunked) — it starts automatically for files over 4MB.`,
        useChunked: true
      },
      { status: 413 }
    );
  }
  const name = file.name.toLowerCase();
  const text = await file.text();
  let count = 0;
  try {
    const engine = getEngine();
    if (name.endsWith(".json")) {
      const docs = jsonToDocuments(text);
      engine.replaceDocuments(docs);
      count = docs.length;
    } else {
      const docs = csvToDocuments(text);
      engine.replaceDocuments(docs);
      count = docs.length;
    }
    let warning: string | undefined;
    try {
      const engine = getEngine();
      await saveSnapshotToBlob(engine.getDocuments());
      markEngineHydrated();
    } catch (e) {
      const message = e instanceof Error ? e.message : "snapshot failed";
      warning = `Index built in memory, but persisting snapshot to Blob failed: ${message}.`;
    }
    return NextResponse.json({ ok: true, indexed: count, warning });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Ingest failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
