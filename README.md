# Semantic Search (SDK + Web)

Offline-capable **TF–IDF** product search: TypeScript SDK (`sdk/`) and a **Next.js** upload + search UI (`web/`). For large files the server **streams CSV/JSONL** and uses **chunked uploads** so multi‑hundred‑MB catalogs are not read as a single string.

**Repository:** [github.com/muttonkodibiriyani/Semantic-Search](https://github.com/muttonkodibiriyani/Semantic-Search)

## Security and data (read this)

- **Do not commit** real customer, pricing, or internal assortment data to GitHub (even in a private repo, treat Git as the wrong place for large proprietary CSVs).
- This repo’s `.gitignore` blocks typical catalog extensions; only the tiny **synthetic** demo under `web/public/demo/sample-products.csv` is allowed.
- For a **manager demo with real data**: run the app **locally** or on **your** controlled host, keep the CSV **outside** the repo (e.g. `D:\catalogs\products.csv`), and upload through the UI—or use a short‑lived tunnel (e.g. ngrok) to your laptop, not a public upload of the raw file to a third party.

## Deploy on Vercel (new project)

1. Push this repo to GitHub (default branch `main`).
2. Open [vercel.com/new](https://vercel.com/new) → **Import** the **Semantic-Search** repository.
3. **Critical — Root Directory:** on the import screen (or later under **Settings → General → Build & Deployment**), set **Root Directory** to **`web`**. Do **not** leave it empty or `/`. This repo’s Next.js app and `package.json` live under `web/`; the repo root has **no** Next app, so the wrong root produces failed or “empty” deployments.
4. **Framework** should stay **Next.js**. **Build & Install** — leave defaults (`npm run build` / `npm install`). The `web` app’s `prebuild` script compiles the sibling `sdk/` package automatically.
5. **Deploy**, wait until the deployment is **Ready**. Open the **Production** URL from the **Deployments** page (the deployment marked **Production** / current).

### Vercel shows `404 NOT_FOUND` (white page, `Code: NOT_FOUND`)

That response means the **hostname is not attached to a successful deployment** (see [Vercel: NOT_FOUND](https://vercel.com/docs/errors/not_found)). Typical causes:

| Cause | What to do |
|--------|------------|
| **Root Directory** was not set to **`web`** | Fix it in **Settings → General**, then **Redeploy** the latest commit. |
| You bookmarked a **preview** hostname (often looks like `semantic-search-ivory.vercel.app` — a random word before `.vercel.app`) | That URL is **not** your stable production domain. When that preview is replaced or garbage‑collected, Vercel returns **NOT_FOUND** forever for that hostname. Open **Vercel → your project → Settings → Domains** and use the **Production** domain (pattern `https://<project-name>-<team-slug>.vercel.app`). |
| Latest deployment **failed** or was **canceled** | Open **Deployments →** select the failed build → **Build Logs** and fix the error (missing env, install failure, etc.). |

After changing **Root Directory**, you must trigger a **new deployment** (Redeploy or push a commit); old deployment URLs may keep returning NOT_FOUND.

### Browser shows `401 Unauthorized` on the real `*.vercel.app` URL

That usually means **Deployment Protection** is on (Vercel Authentication, password, etc.), so the deployment exists but strangers cannot open it. See [Deployment Protection](https://vercel.com/docs/deployments/deployment-protection).

For a **public** demo: **Settings → Deployment Protection** and either disable protection for **Production**, or set **Standard Protection** so only previews are protected (pick the option that matches your org policy). Then reload the **production** domain from **Settings → Domains** (not an old `*-ivory-*` preview link).

Optional env (in Vercel → Project → Settings → Environment Variables):

- `NEXT_PUBLIC_PRODUCT_URL_BASE` — e.g. `https://ae.hm.com/en/buy` for demo PDP links.

`web/vercel.json` sets **up to 300s** for the large ingest **complete** route; on **Hobby** plans Vercel may cap lower (upgrade to **Pro** for long-running indexing, or index huge CSVs locally).

### Large uploads on Vercel (fixes “Unknown or expired upload session”)

Chunked upload stores session metadata in `/tmp`, but **each serverless invocation can run on a different machine**, so `init` → `chunk` → `complete` often **lose the session**. Fix:

1. In Vercel: **Storage → Blob** → create a store and **connect** it to this project (adds **`BLOB_READ_WRITE_TOKEN`** automatically).
2. Redeploy. Files **over 4MB** will upload **directly to Blob** from the browser, then the app calls **`/api/ingest/from-url`** to download and index (no cross-invocation session).

Without Blob, use **`npm run dev`** locally for large CSVs, or keep files under **4MB** for single `POST /api/ingest`.

### Index a CSV that is **already** in your Blob store (no re-upload)

If the file is already uploaded to this project's Blob store (via dashboard, the SDK, or a previous browser upload), you can index it directly without re-uploading from your machine.

- In the UI, the panel **“Index a file already in Vercel Blob”** appears whenever the project lists at least one `.csv` / `.tsv` blob. Pick the file and click **Index this blob**.
- Programmatically:

  ```bash
  curl -sS -X POST "$BASE/api/ingest/from-blob-pathname" \
    -H "Content-Type: application/json" \
    -d '{"pathname":"<pathname-from-/api/ingest/blobs>"}'
  ```

The server streams the blob (with the project's `BLOB_READ_WRITE_TOKEN` for **private** stores), parses it without staging on `/tmp`, builds the in-memory TF–IDF index, and persists a snapshot at `_semantic-search/index-snapshot.json` in the same Blob store. `/api/search` and `/api/stats` lazily hydrate that snapshot on cold lambdas, so search keeps working across invocations.

### Row cap on Vercel — `SEMANTIC_SEARCH_MAX_ROWS`

The BM25 engine is held in lambda memory; on **Hobby** the function has ~300 s and ~1 GB RAM. To stay within those limits when ingesting a large catalog, the app applies a default cap of **100,000 rows** when `VERCEL=1`. Empirically on a 987 MB PIM-style CSV:

| Rows | Ingest time | Snapshot (gzip) | Status |
|---|---|---|---|
| 30,000 | ~17 s | ~12 MB | comfortable |
| 60,000 | ~36 s | ~25 MB | recommended |
| 100,000 | timed out / OOM | — | requires Pro plan or more memory |

Set the env var in Vercel → **Settings → Environment Variables**:

- `SEMANTIC_SEARCH_MAX_ROWS=60000` — proven sweet spot on Hobby
- empty or `0` — no cap (only safe locally, or on Pro with extra memory)

A truncated index is reported in the ingest response's `warning` field and surfaced in the UI.

### Hobby Blob storage budget (1 GB total)

Vercel Blob's free tier has a 1 GB ceiling. A 987 MB CSV plus a gzipped index snapshot will blow through that. The app saves the snapshot at `_semantic-search/index-snapshot.json.gz` (gzip-compressed JSON of the full product documents), which is ~25 MB at 60,000 rows. If the snapshot save fails because of `Storage quota exceeded`, free space by either:

- Clicking **Delete from Blob** in the UI to remove the source CSV after a successful ingest (the catalog data lives in the snapshot now), or
- Calling `POST /api/admin/free-blob` with `{ "pathname": "<your-csv>" }` from the CLI.

Re-uploading the CSV is only required when you want to re-index with a different `SEMANTIC_SEARCH_MAX_ROWS`.

### Why the search results are different now (BM25 + facets)

The retriever is no longer plain TF–IDF cosine. It now does what OpenSearch and the AWS DocumentDB-on-OpenSearch blog describe as the **lexical** stage of a hybrid pipeline, in process:

1. **Query understanding** parses the natural-language query into structured facets (`gender`, `category`, `color`, `priceMax`) plus the residual tokens. Categories are mutually exclusive, so a query for `shoes` does **not** match `sandals`, `slippers`, or `boots`.
2. **Per-row facets** are derived during ingest from PIM fields (`HNMDefault~customerGroup`, `HNMDefault~color`, name keywords, prices) and stored in `meta._facet_*`.
3. **Hard filter** narrows the candidate pool to documents that satisfy every detected facet, so `men red shoes` cannot return women's dresses ever again.
4. **BM25 ranking** (`k1=1.2`, `b=0.75`) over the candidate pool with field weights `title × 5`, `description × 1`, `attributes × 0.5`.
5. **Calibrated 0–1 score** combines `0.45 · term coverage + 0.35 · normalized BM25 + 0.20 · facet alignment`. A score of `1.000` means the top hit covered every query token in fields it appears in and matched every detected facet.

Empty result pools (e.g. `men red shoes`) mean no row in the indexed slice satisfies all detected facets — the engine deliberately returns nothing rather than smuggle in the wrong category. To upgrade to true neural semantic search (cross-language synonyms, paraphrase tolerance) the next step is to embed the catalog with a model (OpenAI `text-embedding-3-small`, AWS Bedrock Titan, etc.) and store vectors in **Upstash Vector**, **Pinecone**, **OpenSearch k-NN**, or **Postgres + pgvector** — the architecture described in the AWS DocumentDB + OpenSearch blog you linked.

## Public “weblink” for your manager

1. **Quick demo:** After the Vercel steps above, open your `.vercel.app` URL and use **Load demo catalog**, then search.
2. **Real large CSV:** Vercel has **tight time and memory limits**; multi‑GB indexing is often not realistic there. For huge files, run `npm run dev` locally (with more heap if needed) or use a VM you control—not a public git push of the CSV.

## Troubleshooting: `Cannot find module './331.js'` / `./611.js`

**Cause:** If this app sits inside a bigger repo that has its own `package-lock.json`, Next.js 15 can infer the **wrong workspace root**. The server bundle then loads chunks with the wrong path (`./331.js` instead of `./chunks/331.js`) and `next start` / Vercel crash with `MODULE_NOT_FOUND`.

**Fix:** `web/next.config.ts` sets `outputFileTracingRoot` to **`path.resolve(__dirname)`** (this app directory only—not `..` to `semantic-search/`). After any config change, from `web/` run `npm run clean && npm run build`.

Stale `.next` can cause similar errors; use `npm run dev:clean` on Windows or `npm run clean` then dev/build. On Vercel, set **Root Directory = `web`** so builds run from this app folder.

## Local run

```bash
cd sdk && npm install && npm run build
cd ../web && npm install && npm run dev
```

Open **http://127.0.0.1:3200** (dev server listens on `0.0.0.0`).

## Where to put a large CSV on your PC

Put it **anywhere on disk** (Downloads, `D:\data\`, etc.). In the browser, use **Choose file** and pick that path—Cursor does not need to host the file. The app reads it at upload/index time; it is **not** stored in the git repo.

## Honest note on “best semantic search”

Strong production systems usually combine **embedding models** + **vector databases** + **reranking**. This project is a clear, auditable **lexical** baseline (TF–IDF) that runs **without** paid LLM credits and is a solid stepping stone—not a claim to beat every hosted semantic stack in the world.

## Merging without review (this repo only)

GitHub **does not** let a workflow use the default `GITHUB_TOKEN` to post an approving **PR review** on the same repo (that would defeat the review model). To allow **merge without human review** for *only* [Semantic-Search](https://github.com/muttonkodibiriyani/Semantic-Search):

1. On GitHub: **Settings → Rules → Rulesets** (or **Branches → Branch protection rules** on `main`).
2. Either **do not** enable “Require pull request reviews”, or set **Required approvals** to **0**.
3. Optionally turn on **Allow auto-merge** so merges go through as soon as required checks (e.g. the **CI** workflow) pass.

Using a personal access token in Actions to auto-approve every PR is possible but is a **security risk** and is not configured here.

## Paperclip

See `PAPERCLIP.md` for agent/workspace notes.
