export { tokenize } from "./tokenize.js";
export { TfidfIndex, type IndexedDocument } from "./tfidf-index.js";

import type { IndexedDocument } from "./tfidf-index.js";
import { TfidfIndex } from "./tfidf-index.js";

/**
 * High-level helper: maintain a TF–IDF index over product-like rows.
 * Works fully offline (no embedding API). Upgrade path: swap in dense embeddings later.
 */
export class SemanticSearchEngine {
  private readonly index = new TfidfIndex();

  /** Clear the index before streaming a large catalog (call once). */
  beginReplace(): void {
    this.index.clear();
  }

  /** Append rows without rebuilding vectors (call many times, then finalizeReplace). */
  appendBatch(docs: IndexedDocument[]): void {
    for (const d of docs) this.index.addDocument(d);
  }

  /** Rebuild TF–IDF after all batches are appended. */
  finalizeReplace(): void {
    this.index.build();
  }

  replaceDocuments(docs: IndexedDocument[]): void {
    this.index.clear();
    for (const d of docs) this.index.addDocument(d);
    this.index.build();
  }

  addDocuments(docs: IndexedDocument[]): void {
    for (const d of docs) this.index.addDocument(d);
    this.index.build();
  }

  search(query: string, topK = 20): { document: IndexedDocument; score: number }[] {
    return this.index.search(query, topK);
  }

  get documentCount(): number {
    return this.index.size;
  }
}
