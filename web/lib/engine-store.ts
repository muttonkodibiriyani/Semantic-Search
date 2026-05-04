import { ProductSearchEngine } from "./product-engine";

const g = globalThis as unknown as { __semanticSearchEngine?: ProductSearchEngine };

export function getEngine(): ProductSearchEngine {
  if (!g.__semanticSearchEngine) {
    g.__semanticSearchEngine = new ProductSearchEngine();
  }
  return g.__semanticSearchEngine;
}
