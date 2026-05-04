import { NextResponse } from "next/server";
import { tokenize } from "semantic-search-sdk";
import { getEngine } from "@/lib/engine-store";
import { hydrateEngineFromBlob } from "@/lib/index-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PipelineStage = {
  key: string;
  label: string;
  detail: string;
};

function keywordBoost(
  hits: { document: { id: string; text: string; meta?: Record<string, string> }; score: number }[],
  query: string
): { document: (typeof hits)[0]["document"]; score: number }[] {
  const raw = query.toLowerCase().normalize("NFC");
  const words = raw
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]+/gu, ""))
    .filter((w) => w.length >= 2);
  if (words.length === 0) return hits;
  return hits
    .map(({ document, score }) => {
      const blob = `${document.text}\n${Object.values(document.meta ?? {}).join(" ")}`.toLowerCase();
      let extra = 0;
      for (const w of words) {
        if (blob.includes(w)) extra += 0.04;
      }
      return { document, score: score + extra };
    })
    .sort((a, b) => b.score - a.score);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") || "").trim();
  const topK = Math.min(50, Math.max(1, Number(searchParams.get("topK") || "25") || 25));

  const engine = getEngine();
  if (engine.documentCount === 0) {
    try {
      await hydrateEngineFromBlob();
    } catch {
      /* ignore — search will report empty index */
    }
  }
  const indexed = engine.documentCount;

  if (!q) {
    return NextResponse.json({
      results: [],
      pipeline: buildPipeline(q, [], indexed, "Enter a search query.")
    });
  }

  const queryTokens = tokenize(q);
  const rawHits = engine.search(q, topK);
  const hits = keywordBoost(rawHits, q);

  const results = hits.map((h) => {
    const meta = h.document.meta ?? {};
    const label =
      meta.Name ||
      meta.name ||
      meta.title ||
      meta.product ||
      meta.product_name ||
      h.document.id;
    const snippet =
      meta["Long Description"] ||
      meta["Long description"] ||
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
      primaryImage: meta.primaryImage,
      productUrl: meta.productUrl,
      styleCode: meta.parentStyleCode || meta["Style Code"],
      meta
    };
  });

  const pipeline = buildPipeline(
    q,
    queryTokens,
    indexed,
    results.length ? `Returning ${results.length} ranked matches.` : "No lexical overlap for this query — try other words or re-upload the catalog."
  );

  return NextResponse.json({ results, pipeline });
}

function buildPipeline(
  query: string,
  queryTokens: string[],
  indexed: number,
  retrievalNote: string
): { query: string; queryTokens: string[]; indexedDocuments: number; stages: PipelineStage[] } {
  return {
    query,
    queryTokens,
    indexedDocuments: indexed,
    stages: [
      {
        key: "query_analysis",
        label: "1 · Query analysis",
        detail:
          queryTokens.length > 0
            ? `Intent expressed as tokens: ${queryTokens.slice(0, 24).join(", ")}${queryTokens.length > 24 ? " …" : ""}`
            : "No tokens after normalization — add words with letters/numbers (works across English and Arabic)."
      },
      {
        key: "lexical_vectors",
        label: "2 · Lexical vectors (TF–IDF)",
        detail:
          indexed > 0
            ? `${indexed} rows indexed. Each row is a sparse term-weight vector (offline lexical model, not a neural embedding API).`
            : "Index is empty — upload a CSV or load the demo catalog first."
      },
      {
        key: "similarity",
        label: "3 · Similarity search",
        detail: "Query vector compared to every document vector (full scan; fine for moderate catalogs)."
      },
      {
        key: "distance_scoring",
        label: "4 · Distance scoring",
        detail: "Cosine similarity between TF–IDF vectors, then a light keyword overlap boost on title/description fields."
      },
      {
        key: "rerank",
        label: "5 · Reranking & filtering",
        detail: retrievalNote
      }
    ]
  };
}
