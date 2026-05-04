import { SemanticSearchEngine } from "semantic-search-sdk";

const g = globalThis as unknown as { __semanticSearchEngine?: SemanticSearchEngine };

export function getEngine(): SemanticSearchEngine {
  if (!g.__semanticSearchEngine) {
    g.__semanticSearchEngine = new SemanticSearchEngine();
  }
  return g.__semanticSearchEngine;
}
