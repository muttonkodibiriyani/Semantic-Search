import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { SNAPSHOT_PATHNAME } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * List the CSV/TSV blobs already uploaded to this project's Blob store so the
 * UI can let the user pick a file to index without re-uploading.
 */
export async function GET() {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ blobs: [] });
  }
  try {
    const result = await list({ token, limit: 100 });
    const blobs = result.blobs
      .filter((b) => b.pathname !== SNAPSHOT_PATHNAME)
      .filter((b) => /\.(csv|tsv)$/i.test(b.pathname))
      .map((b) => ({
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt
      }));
    return NextResponse.json({ blobs });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to list blobs";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
