# Paperclip: semantic-search

Point Paperclip’s project/workspace at this folder:

`c:\Users\tharakeswara.reddy\Downloads\AIC\muttonkodibiriyani\semantic-search`

## What this is

- **`sdk/`** — `semantic-search-sdk`: TF–IDF index + `SemanticSearchEngine` (offline; no Anthropic required for search).
- **`web/`** — Next.js app: upload `.csv` / `.json`, index in memory, search UI (port **3200**).
- **`data/sample-products.csv`** — tiny catalog for a quick demo upload.

## Commands

```bash
cd sdk && npm install && npm run build
cd ../web && npm install && npm run dev
```

Open **`http://127.0.0.1:3200`** (or `http://localhost:3200`). The dev server listens on **all interfaces** (`0.0.0.0`).

- Small files (≤ 4MB): single POST to `/api/ingest`.
- Large files (e.g. 900MB CSV): browser uses **chunked** upload (`/api/ingest/init`, `chunk`, `complete`) then **streaming CSV** indexing — the server does not read the whole file into one string.
- JSON arrays over ~80MB: convert to **`.jsonl`** (one object per line).

If indexing runs out of memory, start Node with a larger heap, e.g. `NODE_OPTIONS=--max-old-space-size=16384`.

In the UI use **“Load safe demo catalog”** (serves `web/public/demo/sample-products.csv`) or upload your own file locally (never commit real CSV to git). Try queries like `blender` or `hiking`.

## Product direction

Replace TF–IDF with embedding + vector store when corporate egress allows your chosen provider; keep the same ingest + API shape where possible.
