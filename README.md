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
| You opened an old **preview** URL (often contains a random word such as `ivory` in the subdomain) | Use the **Production** domain shown on the project overview (e.g. `https://semantic-search-<team>.vercel.app`), not a one-off preview link from an older deployment. |
| Latest deployment **failed** or was **canceled** | Open **Deployments →** select the failed build → **Build Logs** and fix the error (missing env, install failure, etc.). |

After changing **Root Directory**, you must trigger a **new deployment** (Redeploy or push a commit); old deployment URLs may keep returning NOT_FOUND.

Optional env (in Vercel → Project → Settings → Environment Variables):

- `NEXT_PUBLIC_PRODUCT_URL_BASE` — e.g. `https://ae.hm.com/en/buy` for demo PDP links.

`web/vercel.json` sets **up to 300s** for the large ingest **complete** route; on **Hobby** plans Vercel may cap lower (upgrade to **Pro** for long-running indexing, or index huge CSVs locally).

### Large uploads on Vercel (fixes “Unknown or expired upload session”)

Chunked upload stores session metadata in `/tmp`, but **each serverless invocation can run on a different machine**, so `init` → `chunk` → `complete` often **lose the session**. Fix:

1. In Vercel: **Storage → Blob** → create a store and **connect** it to this project (adds **`BLOB_READ_WRITE_TOKEN`** automatically).
2. Redeploy. Files **over 4MB** will upload **directly to Blob** from the browser, then the app calls **`/api/ingest/from-url`** to download and index (no cross-invocation session).

Without Blob, use **`npm run dev`** locally for large CSVs, or keep files under **4MB** for single `POST /api/ingest`.

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
