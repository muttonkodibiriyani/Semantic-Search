import { tokenize } from "semantic-search-sdk";
import {
  CATEGORY_TAXONOMY,
  describeParsedQuery,
  parseQuery,
  type Gender,
  type ParsedQuery
} from "./query-understanding";

/**
 * Indexed product. We keep title/description/attributes as separate fields so
 * BM25 can weight them differently (matches in the title are a much stronger
 * signal than the same word appearing in raw attribute dumps).
 */
export type ProductDocument = {
  id: string;
  title: string;
  description: string;
  attributes: string;
  meta: Record<string, string>;
  gender?: Gender;
  category?: string;
  color?: string;
  customerGroup?: string;
  price?: number;
  primaryImage?: string;
  productUrl?: string;
  styleCode?: string;
  articleNumber?: string;
};

const K1 = 1.2;
const B = 0.75;

const FIELD_WEIGHTS = {
  title: 5.0,
  description: 1.0,
  attributes: 0.5
} as const;

type Posting = { docIdx: number; tf: number };

type FieldIndex = {
  postings: Map<string, Posting[]>;
  docLengths: Float32Array;
  avgDocLength: number;
  idf: Map<string, number>;
};

const SCORE_WEIGHTS = {
  /** How much of the query's terms were matched in any field. */
  coverage: 0.45,
  /** BM25 score normalized against the best document for this query. */
  bm25Norm: 0.35,
  /** Whether the document satisfies all detected facets. */
  facets: 0.20
} as const;

export class ProductSearchEngine {
  private docs: ProductDocument[] = [];
  private titleField!: FieldIndex;
  private descField!: FieldIndex;
  private attrField!: FieldIndex;
  private byGender = new Map<Gender, Set<number>>();
  private byCategory = new Map<string, Set<number>>();
  private byColor = new Map<string, Set<number>>();
  private built = false;

  beginReplace(): void {
    this.docs = [];
    this.byGender.clear();
    this.byCategory.clear();
    this.byColor.clear();
    this.built = false;
  }

  appendBatch(batch: ProductDocument[]): void {
    for (const d of batch) {
      const idx = this.docs.length;
      this.docs.push(d);
      if (d.gender) this.indexInto(this.byGender, d.gender, idx);
      if (d.category) this.indexInto(this.byCategory, d.category, idx);
      if (d.color) this.indexInto(this.byColor, d.color, idx);
    }
    this.built = false;
  }

  finalizeReplace(): void {
    this.titleField = this.buildField((d) => d.title);
    this.descField = this.buildField((d) => d.description);
    this.attrField = this.buildField((d) => d.attributes);
    this.built = true;
  }

  replaceDocuments(docs: ProductDocument[]): void {
    this.beginReplace();
    if (docs.length) this.appendBatch(docs);
    this.finalizeReplace();
  }

  get documentCount(): number {
    return this.docs.length;
  }

  getDocuments(): ProductDocument[] {
    return this.docs;
  }

  facetSummary(): {
    genders: { key: Gender; count: number }[];
    categories: { key: string; label: string; count: number }[];
    colors: { key: string; count: number }[];
  } {
    const fmt = <K extends string>(m: Map<K, Set<number>>) =>
      [...m.entries()]
        .map(([key, ids]) => ({ key, count: ids.size }))
        .sort((a, b) => b.count - a.count);
    return {
      genders: fmt(this.byGender),
      categories: [...this.byCategory.entries()]
        .map(([key, ids]) => ({
          key,
          label: CATEGORY_TAXONOMY[key]?.label ?? key,
          count: ids.size
        }))
        .sort((a, b) => b.count - a.count),
      colors: fmt(this.byColor)
    };
  }

  search(
    rawQuery: string,
    topK = 25
  ): {
    parsed: ParsedQuery;
    intent: string;
    candidatePool: number;
    results: {
      document: ProductDocument;
      score: number;
      diagnostics: {
        bm25: number;
        bm25Norm: number;
        coverage: number;
        facetMatch: number;
        matchedTerms: string[];
        matchedFacets: string[];
      };
    }[];
  } {
    if (!this.built) this.finalizeReplace();
    const parsed = parseQuery(rawQuery);
    const intent = describeParsedQuery(parsed);

    if (this.docs.length === 0) {
      return { parsed, intent, candidatePool: 0, results: [] };
    }
    if (parsed.tokens.length === 0) {
      return { parsed, intent, candidatePool: 0, results: [] };
    }

    const candidates = this.buildCandidatePool(parsed);
    const candidatePool = candidates ? candidates.size : this.docs.length;
    if (candidates && candidates.size === 0) {
      return { parsed, intent, candidatePool, results: [] };
    }

    type Acc = { bm25: number; matched: Set<string> };
    const accum = new Map<number, Acc>();
    for (const term of parsed.tokens) {
      this.scoreField(this.titleField, term, FIELD_WEIGHTS.title, candidates, accum);
      this.scoreField(this.descField, term, FIELD_WEIGHTS.description, candidates, accum);
      this.scoreField(this.attrField, term, FIELD_WEIGHTS.attributes, candidates, accum);
    }

    if (accum.size === 0) {
      // Fallback: if we hard-filtered to a candidate set but found no token
      // overlap, return facet-matched products by recency-style ordering so
      // the user still sees representative examples for the intent.
      if (candidates) {
        const fallback = [...candidates].slice(0, topK).map((idx) => {
          const doc = this.docs[idx];
          const facets = this.facetMatch(parsed, doc);
          return {
            document: doc,
            score: 0.55 * facets.match,
            diagnostics: {
              bm25: 0,
              bm25Norm: 0,
              coverage: 0,
              facetMatch: facets.match,
              matchedTerms: [],
              matchedFacets: facets.matched
            }
          };
        });
        return { parsed, intent, candidatePool, results: fallback };
      }
      return { parsed, intent, candidatePool, results: [] };
    }

    let maxBm25 = 0;
    for (const v of accum.values()) if (v.bm25 > maxBm25) maxBm25 = v.bm25;

    const totalTerms = parsed.tokens.length;
    const out: ReturnType<typeof this.search>["results"] = [];
    for (const [docIdx, v] of accum) {
      const doc = this.docs[docIdx];
      const coverage = v.matched.size / totalTerms;
      const bm25Norm = maxBm25 > 0 ? v.bm25 / maxBm25 : 0;
      const facets = this.facetMatch(parsed, doc);
      const score =
        SCORE_WEIGHTS.coverage * coverage +
        SCORE_WEIGHTS.bm25Norm * bm25Norm +
        SCORE_WEIGHTS.facets * facets.match;
      out.push({
        document: doc,
        score,
        diagnostics: {
          bm25: v.bm25,
          bm25Norm,
          coverage,
          facetMatch: facets.match,
          matchedTerms: [...v.matched],
          matchedFacets: facets.matched
        }
      });
    }
    out.sort((a, b) => b.score - a.score);
    return { parsed, intent, candidatePool, results: out.slice(0, topK) };
  }

  private indexInto<K>(map: Map<K, Set<number>>, key: K, idx: number) {
    let s = map.get(key);
    if (!s) {
      s = new Set();
      map.set(key, s);
    }
    s.add(idx);
  }

  private buildField(getText: (d: ProductDocument) => string): FieldIndex {
    const postings = new Map<string, Posting[]>();
    const docLengths = new Float32Array(this.docs.length);
    let totalLen = 0;
    for (let i = 0; i < this.docs.length; i++) {
      const tokens = tokenize(getText(this.docs[i]) || "");
      docLengths[i] = tokens.length;
      totalLen += tokens.length;
      const tf = new Map<string, number>();
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
      for (const [term, count] of tf) {
        let arr = postings.get(term);
        if (!arr) {
          arr = [];
          postings.set(term, arr);
        }
        arr.push({ docIdx: i, tf: count });
      }
    }
    const avgDocLength = this.docs.length > 0 ? totalLen / this.docs.length : 0;
    const idf = new Map<string, number>();
    const N = this.docs.length;
    for (const [term, arr] of postings) {
      const df = arr.length;
      idf.set(term, Math.log((N - df + 0.5) / (df + 0.5) + 1));
    }
    return { postings, docLengths, avgDocLength, idf };
  }

  private scoreField(
    field: FieldIndex,
    term: string,
    weight: number,
    candidates: Set<number> | null,
    accum: Map<number, { bm25: number; matched: Set<string> }>
  ): void {
    const arr = field.postings.get(term);
    if (!arr) return;
    const idf = field.idf.get(term) ?? 0;
    if (idf <= 0) return;
    const avgDl = Math.max(field.avgDocLength, 1);
    for (const { docIdx, tf } of arr) {
      if (candidates && !candidates.has(docIdx)) continue;
      const dl = field.docLengths[docIdx];
      const denom = tf + K1 * (1 - B + B * (dl / avgDl));
      const contribution = weight * idf * ((tf * (K1 + 1)) / Math.max(denom, 1e-6));
      let entry = accum.get(docIdx);
      if (!entry) {
        entry = { bm25: 0, matched: new Set<string>() };
        accum.set(docIdx, entry);
      }
      entry.bm25 += contribution;
      entry.matched.add(term);
    }
  }

  private buildCandidatePool(q: ParsedQuery): Set<number> | null {
    const filters: Set<number>[] = [];

    if (q.gender) {
      const s = this.byGender.get(q.gender);
      if (!s) return new Set();
      filters.push(s);
    }
    if (q.category) {
      const s = this.byCategory.get(q.category);
      if (!s) return new Set();
      filters.push(s);
    }
    if (q.colors.length > 0) {
      const merged = new Set<number>();
      for (const c of q.colors) {
        const s = this.byColor.get(c);
        if (s) for (const i of s) merged.add(i);
      }
      if (merged.size === 0) return new Set();
      filters.push(merged);
    }
    if (q.priceMax != null) {
      const within = new Set<number>();
      for (let i = 0; i < this.docs.length; i++) {
        const p = this.docs[i].price;
        if (p != null && p <= q.priceMax) within.add(i);
      }
      filters.push(within);
    }

    if (filters.length === 0) return null;

    let smallestIdx = 0;
    for (let i = 1; i < filters.length; i++) {
      if (filters[i].size < filters[smallestIdx].size) smallestIdx = i;
    }
    const out = new Set<number>();
    for (const idx of filters[smallestIdx]) {
      let inAll = true;
      for (let i = 0; i < filters.length; i++) {
        if (i === smallestIdx) continue;
        if (!filters[i].has(idx)) {
          inAll = false;
          break;
        }
      }
      if (inAll) out.add(idx);
    }
    return out;
  }

  private facetMatch(q: ParsedQuery, d: ProductDocument): { match: number; matched: string[] } {
    const requested: string[] = [];
    const matched: string[] = [];
    if (q.gender) {
      requested.push(`gender=${q.gender}`);
      if (d.gender === q.gender) matched.push(`gender=${q.gender}`);
    }
    if (q.category) {
      requested.push(`category=${q.category}`);
      if (d.category === q.category) matched.push(`category=${q.category}`);
    }
    if (q.colors.length > 0) {
      const wanted = q.colors.join("|");
      requested.push(`color=${wanted}`);
      if (d.color && q.colors.includes(d.color)) matched.push(`color=${d.color}`);
    }
    if (q.priceMax != null) {
      requested.push(`priceMax=${q.priceMax}`);
      if (d.price != null && d.price <= q.priceMax) matched.push(`priceMax=${q.priceMax}`);
    }
    const match = requested.length === 0 ? 1 : matched.length / requested.length;
    return { match, matched };
  }
}
