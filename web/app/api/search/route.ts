import { NextResponse } from "next/server";
import { getEngine } from "@/lib/engine-store";
import { hydrateEngineFromBlob } from "@/lib/index-snapshot";
import { CATEGORY_TAXONOMY } from "@/lib/query-understanding";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PipelineStage = { key: string; label: string; detail: string };

function describeFacets(parsed: {
  gender?: string;
  category?: string;
  colors: string[];
  priceMax?: number;
  tokens: string[];
}): string {
  const bits: string[] = [];
  if (parsed.gender) bits.push(`gender=${parsed.gender}`);
  if (parsed.category) {
    const label = CATEGORY_TAXONOMY[parsed.category]?.label ?? parsed.category;
    bits.push(`category=${parsed.category} (${label})`);
  }
  if (parsed.colors.length > 0) bits.push(`colors=[${parsed.colors.join(", ")}]`);
  if (parsed.priceMax != null) bits.push(`priceMax=${parsed.priceMax}`);
  return bits.length === 0 ? "no facets — pure text match" : bits.join(" · ");
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
      pipeline: buildPipeline({
        query: "",
        intent: "—",
        candidatePool: indexed,
        indexed,
        topHitScore: null,
        topMatchedFacets: [],
        topMatchedTerms: [],
        retrievalNote: "Enter a search query."
      })
    });
  }

  const out = engine.search(q, topK);
  const results = out.results.map((h) => {
    const meta = h.document.meta ?? {};
    const label = h.document.title || meta.Name || meta.name || h.document.id;
    const snippet =
      h.document.description ||
      meta["Long Description"] ||
      meta.description ||
      meta.body ||
      "";
    return {
      id: h.document.id,
      score: Number(h.score.toFixed(4)),
      label,
      snippet: snippet.slice(0, 280),
      primaryImage: h.document.primaryImage || meta.primaryImage,
      productUrl: h.document.productUrl || meta.productUrl,
      styleCode: h.document.styleCode,
      gender: h.document.gender,
      category: h.document.category,
      categoryLabel: h.document.category ? CATEGORY_TAXONOMY[h.document.category]?.label : undefined,
      color: h.document.color,
      customerGroup: h.document.customerGroup,
      price: h.document.price,
      diagnostics: {
        bm25: Number(h.diagnostics.bm25.toFixed(2)),
        bm25Norm: Number(h.diagnostics.bm25Norm.toFixed(3)),
        coverage: Number(h.diagnostics.coverage.toFixed(3)),
        facetMatch: Number(h.diagnostics.facetMatch.toFixed(3)),
        matchedTerms: h.diagnostics.matchedTerms,
        matchedFacets: h.diagnostics.matchedFacets
      },
      meta
    };
  });

  const top = results[0];
  const pipeline = buildPipeline({
    query: out.parsed.raw,
    intent: describeFacets(out.parsed),
    candidatePool: out.candidatePool,
    indexed,
    topHitScore: top ? top.score : null,
    topMatchedFacets: top?.diagnostics.matchedFacets ?? [],
    topMatchedTerms: top?.diagnostics.matchedTerms ?? [],
    retrievalNote: results.length
      ? `Returning ${results.length} ranked match${results.length === 1 ? "" : "es"} (top score ${top!.score}).`
      : out.candidatePool === 0
        ? "Facet filter eliminated every document — try removing a constraint."
        : "No lexical overlap. Try other words or re-index after enabling Arabic/English fields."
  });

  return NextResponse.json({ results, pipeline });
}

function buildPipeline(args: {
  query: string;
  intent: string;
  candidatePool: number;
  indexed: number;
  topHitScore: number | null;
  topMatchedFacets: string[];
  topMatchedTerms: string[];
  retrievalNote: string;
}): { query: string; intent: string; indexedDocuments: number; candidatePool: number; stages: PipelineStage[] } {
  const { query, intent, candidatePool, indexed, topHitScore, topMatchedFacets, topMatchedTerms, retrievalNote } = args;
  return {
    query,
    intent,
    indexedDocuments: indexed,
    candidatePool,
    stages: [
      {
        key: "query_understanding",
        label: "1 · Query understanding",
        detail: query
          ? `Detected intent → ${intent}. Tokens: ${topMatchedTerms.length ? topMatchedTerms.join(", ") : "(none yet)"}.`
          : "Enter a query — the parser pulls gender / category / colors / price out of natural language."
      },
      {
        key: "facet_filter",
        label: "2 · Facet hard-filter",
        detail:
          candidatePool === indexed
            ? `No structured filter applied — ${indexed.toLocaleString()} documents are scoring candidates.`
            : `Reduced from ${indexed.toLocaleString()} → ${candidatePool.toLocaleString()} candidates by applying gender/category/color/price filters before ranking.`
      },
      {
        key: "bm25",
        label: "3 · BM25 ranking (weighted fields)",
        detail: "title × 5, description × 1, attributes × 0.5. BM25 (k1=1.2, b=0.75) over the candidate pool."
      },
      {
        key: "scoring",
        label: "4 · Calibrated match score",
        detail:
          "score = 0.45 · term coverage + 0.35 · normalized BM25 + 0.20 · facet alignment. Coverage rewards queries whose words actually appear; facet alignment rewards documents satisfying every detected constraint."
      },
      {
        key: "rerank",
        label: "5 · Reranking & response",
        detail:
          retrievalNote +
          (topHitScore != null && topMatchedFacets.length
            ? ` Top hit matches facets: ${topMatchedFacets.join(", ")}.`
            : "")
      }
    ]
  };
}
