import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine-store";
import { hydrateEngineFromBlob } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const engine = getEngine();
  if (engine.documentCount === 0) {
    try {
      await hydrateEngineFromBlob();
    } catch {
      /* ignore — fall through to current count */
    }
  }
  return NextResponse.json({ documents: engine.documentCount });
}
