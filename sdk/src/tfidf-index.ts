import { tokenize } from "./tokenize.js";

export type IndexedDocument = {
  id: string;
  text: string;
  meta?: Record<string, string>;
};

type Sparse = Map<number, number>;

function norm(sparse: Sparse): number {
  let s = 0;
  for (const v of sparse.values()) s += v * v;
  return Math.sqrt(s) || 1;
}

function cosine(a: Sparse, b: Sparse): number {
  let dot = 0;
  for (const [i, av] of a) {
    const bv = b.get(i);
    if (bv != null) dot += av * bv;
  }
  return dot / (norm(a) * norm(b));
}

export class TfidfIndex {
  private termToIndex = new Map<string, number>();
  private documents: IndexedDocument[] = [];
  private vectors: Sparse[] = [];
  private idf = new Map<number, number>();
  private built = false;

  clear(): void {
    this.termToIndex.clear();
    this.documents = [];
    this.vectors = [];
    this.idf.clear();
    this.built = false;
  }

  addDocument(doc: IndexedDocument): void {
    this.documents.push({ ...doc, text: doc.text.trim() });
    this.built = false;
  }

  get size(): number {
    return this.documents.length;
  }

  build(): void {
    const N = this.documents.length;
    if (N === 0) {
      this.vectors = [];
      this.built = true;
      return;
    }

    const df = new Map<number, number>();
    const docTokens: string[][] = [];

    for (const d of this.documents) {
      const toks = tokenize(d.text);
      docTokens.push(toks);
      const seen = new Set<number>();
      for (const t of toks) {
        let idx = this.termToIndex.get(t);
        if (idx === undefined) {
          idx = this.termToIndex.size;
          this.termToIndex.set(t, idx);
        }
        if (!seen.has(idx)) {
          seen.add(idx);
          df.set(idx, (df.get(idx) || 0) + 1);
        }
      }
    }

    this.idf = new Map();
    for (const [termIdx, dfi] of df) {
      this.idf.set(termIdx, Math.log((N + 1) / (dfi + 1)) + 1);
    }

    this.vectors = docTokens.map((toks) => {
      const tf = new Map<number, number>();
      for (const t of toks) {
        const idx = this.termToIndex.get(t)!;
        tf.set(idx, (tf.get(idx) || 0) + 1);
      }
      const maxTf = Math.max(...tf.values(), 1);
      const vec: Sparse = new Map();
      for (const [idx, c] of tf) {
        const w = (c / maxTf) * (this.idf.get(idx) || 0);
        vec.set(idx, w);
      }
      return vec;
    });

    this.built = true;
  }

  search(query: string, topK = 20): { document: IndexedDocument; score: number }[] {
    if (!this.built) this.build();
    if (this.documents.length === 0) return [];

    const qToks = tokenize(query);
    const qtf = new Map<number, number>();
    for (const t of qToks) {
      const idx = this.termToIndex.get(t);
      if (idx === undefined) continue;
      qtf.set(idx, (qtf.get(idx) || 0) + 1);
    }
    const maxQ = Math.max(...qtf.values(), 1);
    const qVec: Sparse = new Map();
    for (const [idx, c] of qtf) {
      const idfW = this.idf.get(idx);
      if (idfW == null) continue;
      qVec.set(idx, (c / maxQ) * idfW);
    }
    if (qVec.size === 0) return [];

    const scored = this.documents.map((d, i) => ({
      document: d,
      score: cosine(qVec, this.vectors[i] || new Map())
    }));

    return scored
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
