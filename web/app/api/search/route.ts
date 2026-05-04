import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine-store";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  if (!q) {
    return NextResponse.json({ results: [] });
  }
  const topK = Math.min(50, Math.max(1, Number(searchParams.get("topK") || "25") || 25));
  const engine = getEngine();
  const hits = engine.search(q, topK);
  return NextResponse.json({
    results: hits.map((h) => {
      const meta = h.document.meta ?? {};
      const label =
        meta.name ||
        meta.title ||
        meta.product ||
        meta.product_name ||
        meta.Name ||
        h.document.id;
      const snippet =
        meta.description ||
        meta.desc ||
        meta.details ||
        meta.body ||
        "";
      return {
        id: h.document.id,
        score: h.score,
        label,
        snippet: snippet.slice(0, 280),
        meta
      };
    })
  });
}
