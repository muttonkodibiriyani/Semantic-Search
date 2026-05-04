import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Client-upload handshake for @vercel/blob (browser uploads directly to Blob storage).
 * Requires BLOB_READ_WRITE_TOKEN on the project (Vercel → Storage → Blob).
 */
export async function POST(request: Request) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN is not configured." }, { status: 503 });
  }
  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: [
          "text/csv",
          "text/plain",
          "application/csv",
          "application/octet-stream",
          "application/vnd.ms-excel",
          "application/json"
        ],
        maximumSizeInBytes: 500 * 1024 * 1024,
        addRandomSuffix: true
      }),
      onUploadCompleted: async () => {
        /* Indexing is triggered from the client via /api/ingest/from-url */
      }
    });
    return NextResponse.json(response);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Blob upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
