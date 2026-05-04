/**
 * Lightweight rules-based query understanding for product search.
 *
 * The user types something like "men red shoes under 200" — we break that
 * into structured facets ({gender, colors, category, priceMax}) so the
 * retriever can hard-filter on them before BM25-ranking the residual.
 *
 * This is the same role the "neural + lexical" hybrid plays in OpenSearch
 * (see https://docs.opensearch.org/latest/vector-search/ai-search/semantic-search/),
 * implemented in-process so it works inside a Vercel Hobby lambda.
 */

export type Gender = "men" | "women" | "boy" | "girl" | "unisex";

export type ParsedQuery = {
  raw: string;
  gender?: Gender;
  /** Canonical category key from CATEGORY_TAXONOMY. */
  category?: string;
  /** Canonical color names found in the query (English). */
  colors: string[];
  /** Optional max price (extracted from "under N", "below N", "<N"). */
  priceMax?: number;
  /** All meaningful tokens (used by the BM25 ranker). */
  tokens: string[];
};

const GENDER_RULES: Array<{ gender: Gender; words: string[] }> = [
  { gender: "men", words: ["men", "man", "mens", "mans", "male", "males", "gentleman", "gentlemen", "guy", "guys", "him", "his"] },
  { gender: "women", words: ["women", "woman", "womens", "womans", "female", "females", "lady", "ladies", "gal", "gals", "her"] },
  { gender: "boy", words: ["boy", "boys"] },
  { gender: "girl", words: ["girl", "girls"] },
  { gender: "unisex", words: ["unisex"] }
];

/**
 * Mutually-exclusive product categories. `shoes` does NOT match `sandals`,
 * so a query for "shoes" filters sandals out instead of mixing them in.
 * Order does not matter — longest matched word wins inside each row.
 */
export const CATEGORY_TAXONOMY: Record<string, { label: string; words: string[] }> = {
  shoes: {
    label: "Shoes",
    words: [
      "shoe", "shoes", "sneaker", "sneakers", "trainer", "trainers", "loafer",
      "loafers", "oxford", "oxfords", "brogue", "brogues", "derby", "moccasin",
      "moccasins", "espadrille", "espadrilles", "plimsoll", "plimsolls", "pumps"
    ]
  },
  boots: {
    label: "Boots",
    words: ["boot", "boots", "ankle boot", "ankle boots", "chelsea boot", "chelsea boots"]
  },
  sandals: {
    label: "Sandals",
    words: [
      "sandal", "sandals", "slide", "slides", "flip flop", "flip-flop", "flip-flops",
      "flipflop", "flipflops", "thongs"
    ]
  },
  slippers: { label: "Slippers", words: ["slipper", "slippers"] },
  heels: { label: "Heels", words: ["heel", "heels", "stiletto", "stilettos", "high heel", "high heels"] },

  dress: { label: "Dress", words: ["dress", "dresses", "gown", "gowns", "frock", "frocks"] },
  skirt: { label: "Skirt", words: ["skirt", "skirts"] },
  blouse: { label: "Blouse", words: ["blouse", "blouses"] },
  shirt: { label: "Shirt", words: ["shirt", "shirts"] },
  tshirt: { label: "T-shirt", words: ["t-shirt", "t-shirts", "tshirt", "tshirts", "tee", "tees"] },
  poloshirt: { label: "Polo shirt", words: ["polo", "polos", "polo shirt", "polo shirts"] },

  blazer: { label: "Blazer", words: ["blazer", "blazers"] },
  jacket: { label: "Jacket", words: ["jacket", "jackets", "parka", "parkas", "windbreaker"] },
  coat: { label: "Coat", words: ["coat", "coats", "overcoat", "overcoats", "trench"] },
  hoodie: { label: "Hoodie", words: ["hoodie", "hoodies"] },
  sweatshirt: { label: "Sweatshirt", words: ["sweatshirt", "sweatshirts"] },
  sweater: { label: "Sweater", words: ["sweater", "sweaters", "jumper", "jumpers", "cardigan", "cardigans", "pullover", "pullovers"] },

  jeans: { label: "Jeans", words: ["jeans", "denim", "denims"] },
  trousers: { label: "Trousers", words: ["trouser", "trousers", "pant", "pants", "chino", "chinos", "slacks"] },
  shorts: { label: "Shorts", words: ["short", "shorts", "bermuda", "bermudas"] },
  leggings: { label: "Leggings", words: ["legging", "leggings", "jegging", "jeggings"] },
  joggers: { label: "Joggers", words: ["jogger", "joggers", "tracksuit", "tracksuits"] },

  socks: { label: "Socks", words: ["sock", "socks"] },
  underwear: { label: "Underwear", words: ["underwear", "brief", "briefs", "boxer", "boxers", "panty", "panties"] },
  bra: { label: "Bra", words: ["bra", "bras", "bralette", "bralettes"] },
  swimwear: { label: "Swimwear", words: ["swim", "swimsuit", "swimsuits", "bikini", "bikinis", "trunks"] },

  bag: { label: "Bag", words: ["bag", "bags", "handbag", "handbags", "tote", "totes", "backpack", "backpacks", "rucksack"] },
  belt: { label: "Belt", words: ["belt", "belts"] },
  hat: { label: "Hat", words: ["hat", "hats", "cap", "caps", "beanie", "beanies"] },
  scarf: { label: "Scarf", words: ["scarf", "scarves"] },
  watch: { label: "Watch", words: ["watch", "watches"] },
  jewelry: { label: "Jewelry", words: ["necklace", "necklaces", "earring", "earrings", "ring", "rings", "bracelet", "bracelets"] }
};

/**
 * English color names recognised in queries and product `HNMDefault~color`
 * cells. Multi-word entries (e.g. "navy blue") are matched first.
 */
export const COLOR_VOCAB = [
  "off white",
  "navy blue",
  "light blue",
  "dark blue",
  "royal blue",
  "sky blue",
  "light green",
  "dark green",
  "light pink",
  "hot pink",
  "rose gold",
  "red",
  "blue",
  "navy",
  "black",
  "white",
  "grey",
  "gray",
  "brown",
  "beige",
  "cream",
  "pink",
  "purple",
  "violet",
  "lavender",
  "yellow",
  "orange",
  "green",
  "olive",
  "khaki",
  "gold",
  "silver",
  "maroon",
  "burgundy",
  "ivory",
  "tan",
  "mint",
  "peach",
  "mustard",
  "turquoise",
  "teal",
  "coral",
  "magenta"
];

const STOPWORDS = new Set([
  "a", "an", "and", "the", "of", "for", "with", "without", "in", "on", "at",
  "to", "from", "by", "or", "is", "are", "be", "this", "that", "these", "those",
  "i", "you", "we", "us", "my", "me", "your", "want", "need", "looking", "show",
  "find", "get", "buy", "please", "size", "any", "some", "good", "best"
]);

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function detectGender(lower: string): Gender | undefined {
  for (const { gender, words } of GENDER_RULES) {
    for (const w of words) {
      const re = new RegExp(`\\b${escapeRegex(w)}\\b`, "i");
      if (re.test(lower)) return gender;
    }
  }
  return undefined;
}

function detectCategory(lower: string): { key: string; matchedWord: string } | undefined {
  let bestKey: string | undefined;
  let bestWord = "";
  for (const [key, { words }] of Object.entries(CATEGORY_TAXONOMY)) {
    for (const w of words) {
      const pattern = w.includes(" ") || w.includes("-")
        ? `\\b${escapeRegex(w).replace(/[-\\\\\s]+/g, "[-\\s]+")}\\b`
        : `\\b${escapeRegex(w)}\\b`;
      const re = new RegExp(pattern, "i");
      if (re.test(lower)) {
        if (w.length > bestWord.length) {
          bestKey = key;
          bestWord = w;
        }
      }
    }
  }
  return bestKey ? { key: bestKey, matchedWord: bestWord } : undefined;
}

function detectColors(lower: string): string[] {
  const found = new Set<string>();
  for (const c of COLOR_VOCAB) {
    const pattern = c.includes(" ")
      ? `\\b${escapeRegex(c).replace(/\s+/g, "\\s+")}\\b`
      : `\\b${escapeRegex(c)}\\b`;
    const re = new RegExp(pattern, "i");
    if (re.test(lower)) {
      // Normalize "navy blue" -> "navy", "off white" -> "white" so it overlaps
      // with the single-token color label stored on each product.
      const canonical = c.split(/\s+/).pop()!;
      found.add(canonical);
    }
  }
  return [...found];
}

function detectPriceMax(lower: string): number | undefined {
  const m =
    lower.match(/\bunder\s*(\d{1,6})\b/i) ||
    lower.match(/\bbelow\s*(\d{1,6})\b/i) ||
    lower.match(/<\s*(\d{1,6})\b/);
  if (!m) return undefined;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

function tokenizeForBm25(raw: string): string[] {
  // We deliberately keep facet words in the token stream so a query like
  // "men red shoes" still rewards documents whose name actually says "shoes".
  return raw
    .normalize("NFC")
    .toLowerCase()
    .split(/[\s,.;:!?(){}[\]"'/\\]+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function parseQuery(raw: string): ParsedQuery {
  const text = (raw || "").trim();
  const lower = text.toLowerCase();
  return {
    raw: text,
    gender: detectGender(lower),
    category: detectCategory(lower)?.key,
    colors: detectColors(lower),
    priceMax: detectPriceMax(lower),
    tokens: tokenizeForBm25(text)
  };
}

export function describeParsedQuery(q: ParsedQuery): string {
  const parts: string[] = [];
  if (q.gender) parts.push(`gender=${q.gender}`);
  if (q.category) parts.push(`category=${q.category}`);
  if (q.colors.length) parts.push(`colors=[${q.colors.join(", ")}]`);
  if (q.priceMax) parts.push(`priceMax=${q.priceMax}`);
  if (parts.length === 0) return "no facets detected — pure text match";
  return parts.join(", ");
}
