import { NextResponse } from "next/server";
import { del } from "@vercel/blob";
import { SNAPSHOT_PATHNAME } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = { pathname?: string };

/**
 * Delete a blob from this project's store. Used to free space on the Hobby
 * plan (1 GB total) so the index snapshot can be persisted alongside the
 * source CSV. Refuses to delete the snapshot itself.
 */
export async function POST(req: Request) {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) {
    return NextResponse.json({ error: "BLOB_READ_WRITE_TOKEN not configured." }, { status: 500 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected JSON with `pathname`." }, { status: 400 });
  }
  const pathname = (body.pathname ?? "").trim();
  if (!pathname) {
    return NextResponse.json({ error: "`pathname` is required." }, { status: 400 });
  }
  if (pathname === SNAPSHOT_PATHNAME) {
    return NextResponse.json(
      { error: "Refusing to delete the index snapshot via this endpoint." },
      { status: 400 }
    );
  }
  try {
    await del(pathname, { token });
    return NextResponse.json({ ok: true, deleted: pathname });
  } catch (e) {
    const message = e instanceof Error ? e.message : "delete failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
