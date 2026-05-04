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
3. **Critical:** under **Root Directory**, click **Edit** and set it to **`web`** (not the repo root). Framework should stay **Next.js**.
4. **Build & Install** — leave defaults (`npm run build` / `npm install`). The `web` app’s `prebuild` script compiles the sibling `sdk/` package automatically.
5. **Deploy.** Open the production URL (e.g. `https://<project>.vercel.app`). Use **Load demo catalog** for an instant smoke test; large CSV uploads may hit serverless time/size limits on free tiers.

Optional env (in Vercel → Project → Settings → Environment Variables):

- `NEXT_PUBLIC_PRODUCT_URL_BASE` — e.g. `https://ae.hm.com/en/buy` for demo PDP links.

`web/vercel.json` sets **up to 300s** for the large ingest **complete** route; on **Hobby** plans Vercel may cap lower (upgrade to **Pro** for long-running indexing, or index huge CSVs locally).

## Public “weblink” for your manager

1. **Quick demo:** After the Vercel steps above, open your `.vercel.app` URL and use **Load demo catalog**, then search.
2. **Real large CSV:** Vercel has **tight time and memory limits**; multi‑GB indexing is often not realistic there. For huge files, run `npm run dev` locally (with more heap if needed) or use a VM you control—not a public git push of the CSV.

## Troubleshooting: `Cannot find module './611.js'`

That usually means a **stale or mismatched** `.next` folder (often after moving the repo or changing `next.config`). From the `web` folder run:

```bash
npm run clean
npm install
npm run dev
```

On Windows PowerShell you can use `npm run dev:clean` (clean + dev). Always use **Root Directory = `web`** on Vercel so `outputFileTracingRoot` matches this repo layout.

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
