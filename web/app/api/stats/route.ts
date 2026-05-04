import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine-store";

export const runtime = "nodejs";

export async function GET() {
  const engine = getEngine();
  return NextResponse.json({ documents: engine.documentCount });
}
