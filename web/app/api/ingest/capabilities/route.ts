import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Tells the browser which large-file strategies are available. */
export async function GET() {
  return NextResponse.json({
    vercel: process.env.VERCEL === "1",
    blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN)
  });
}
