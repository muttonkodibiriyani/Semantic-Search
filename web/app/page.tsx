"use client";

import { useCallback, useEffect, useState } from "react";

const MAX_SINGLE_UPLOAD_BYTES = 4 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;

type Hit = {
  id: string;
  score: number;
  label?: string;
  snippet?: string;
  primaryImage?: string;
  productUrl?: string;
  styleCode?: string;
  meta: Record<string, string>;
};

type Pipeline = {
  query: string;
  queryTokens: string[];
  indexedDocuments: number;
  stages: { key: string; label: string; detail: string }[];
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    try {
      const res = await fetch("/api/stats");
      if (!res.ok) return;
      const j = (await res.json()) as { documents: number };
      setDocCount(j.documents);
    } catch {
      setDocCount(null);
    }
  }, []);

  useEffect(() => {
    void refreshStats();
  }, [refreshStats]);

  const uploadChunked = async (file: File) => {
    const totalBytes = file.size;
    const totalChunks = Math.max(1, Math.ceil(totalBytes / CHUNK_SIZE));
    setUploadPhase(`Starting upload (${Math.round(totalBytes / (1024 * 1024))} MB, ${totalChunks} parts)…`);
    const initRes = await fetch("/api/ingest/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, totalBytes, totalChunks })
    });
    const initJson = (await initRes.json()) as { uploadId?: string; error?: string };
    if (!initRes.ok) throw new Error(initJson.error || "Could not start upload.");
    const uploadId = initJson.uploadId;
    if (!uploadId) throw new Error("Server did not return uploadId.");

    for (let i = 0; i < totalChunks; i++) {
      const start = i * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, totalBytes);
      const slice = file.slice(start, end);
      const buf = await slice.arrayBuffer();
      setUploadPhase(`Uploading part ${i + 1} / ${totalChunks}…`);
      const chunkRes = await fetch("/api/ingest/chunk", {
        method: "POST",
        headers: { "x-upload-id": uploadId, "x-chunk-index": String(i) },
        body: buf
      });
      const chunkJson = (await chunkRes.json()) as { error?: string };
      if (!chunkRes.ok) throw new Error(chunkJson.error || `Chunk ${i} failed.`);
    }

    setUploadPhase("Indexing on server (large files can take several minutes)…");
    const doneRes = await fetch("/api/ingest/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId })
    });
    const doneJson = (await doneRes.json()) as {
      ok?: boolean;
      indexed?: number;
      warning?: string;
      error?: string;
    };
    if (!doneRes.ok) throw new Error(doneJson.error || "Indexing failed after upload.");
    let msg = `Indexed ${doneJson.indexed ?? 0} rows.`;
    if (doneJson.warning) msg += ` ${doneJson.warning}`;
    return msg;
  };

  const uploadSmall = async (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/ingest", { method: "POST", body: fd });
    const j = (await res.json()) as { ok?: boolean; indexed?: number; error?: string; useChunked?: boolean };
    if (!res.ok) {
      if (j.useChunked) throw new Error(j.error || "Use chunked upload.");
      throw new Error(j.error || `Upload failed (${res.status}).`);
    }
    return `Indexed ${j.indexed ?? 0} rows.`;
  };

  const loadSafeDemo = async () => {
    setError(null);
    setMessage(null);
    setUploadPhase(null);
    setUploading(true);
    try {
      const res = await fetch("/demo/sample-products.csv");
      if (!res.ok) throw new Error("Demo file missing from this build.");
      const blob = await res.blob();
      const file = new File([blob], "sample-products.csv", { type: "text/csv" });
      const msg = await uploadSmall(file);
      setMessage(`${msg} Synthetic demo only.`);
      setPipeline(null);
      setResults([]);
      await refreshStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load demo.");
    } finally {
      setUploading(false);
    }
  };

  const onUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    setUploadPhase(null);
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      setError("Choose a .csv, .tsv, .json, or .jsonl file first.");
      return;
    }
    setUploading(true);
    try {
      const msg =
        file.size > MAX_SINGLE_UPLOAD_BYTES ? await uploadChunked(file) : await uploadSmall(file);
      setMessage(msg);
      setUploadPhase(null);
      setPipeline(null);
      setResults([]);
      await refreshStats();
    } catch (err) {
      setUploadPhase(null);
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);
    const q = query.trim();
    if (!q) {
      setResults([]);
      setPipeline(null);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
      let j: { results?: Hit[]; pipeline?: Pipeline; error?: string };
      try {
        j = (await res.json()) as typeof j;
      } catch {
        throw new Error("Invalid response from search API.");
      }
      if (!res.ok) throw new Error(j.error || `Search failed (${res.status}).`);
      setResults(j.results || []);
      setPipeline(j.pipeline ?? null);
      if (!j.results?.length) {
        setMessage("No matches — try different words or upload/index again.");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search request failed.");
      setResults([]);
      setPipeline(null);
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="app">
      <header className="hero">
        <p className="kicker">How it works</p>
        <h1>Semantic catalog search</h1>
        <p className="hero-sub">
          Connect your product data, build a lexical index, search in natural language across English and Arabic
          fields, and inspect the five-stage retrieval pipeline on every query.
        </p>
      </header>

      <div className="steps-grid">
        <article className="step-card" data-step="01">
          <div className="step-card-inner">
            <div className="step-icon" style={{ background: "#ecfdf5", color: "#059669" }}>
              ◉
            </div>
            <h3>Connect your data</h3>
            <p>Upload CSV / JSONL exports (PIM fields like SKU, style, descriptions, image URLs).</p>
          </div>
        </article>
        <article className="step-card" data-step="02">
          <div className="step-card-inner">
            <div className="step-icon" style={{ background: "#f5f3ff", color: "#7c3aed" }}>
              ⚡
            </div>
            <h3>Lexical index</h3>
            <p>TF–IDF vectors capture term importance across your catalog (offline — no paid embedding API).</p>
          </div>
        </article>
        <article className="step-card" data-step="03">
          <div className="step-card-inner">
            <div className="step-icon" style={{ background: "#eff6ff", color: "#2563eb" }}>
              ◎
            </div>
            <h3>Search by meaning</h3>
            <p>Same ideas, different wording: cosine similarity + light keyword boost on titles and copy.</p>
          </div>
        </article>
        <article className="step-card" data-step="04">
          <div className="step-card-inner">
            <div className="step-icon" style={{ background: "#fff7ed", color: "#ea580c" }}>
              ✦
            </div>
            <h3>Ranked results</h3>
            <p>Products ordered by relevance with images, SKU, style, and optional PDP-style links.</p>
          </div>
        </article>
      </div>

      <section className="panel">
        <h2>1 · Connect your data</h2>
        <div className="row-actions">
          <button type="button" className="btn btn-secondary" onClick={() => void loadSafeDemo()} disabled={uploading}>
            Load demo catalog
          </button>
        </div>
        <form onSubmit={onUpload}>
          <label className="field" htmlFor="file">
            Catalog file (.csv, .tsv, .json, .jsonl)
          </label>
          <input id="file" name="file" type="file" accept=".csv,.tsv,.json,.jsonl,.ndjson,text/csv,application/json" />
          <button type="submit" className="btn btn-primary" disabled={uploading} style={{ marginTop: "0.75rem" }}>
            {uploading ? "Indexing…" : "Upload & build index"}
          </button>
          <div className="status-line">
            <strong>Indexed rows:</strong> {docCount === null ? "—" : docCount}
            {uploadPhase ? (
              <>
                <br />
                {uploadPhase}
              </>
            ) : null}
          </div>
          {message ? <p className="msg-ok">{message}</p> : null}
          {error ? <p className="msg-error">{error}</p> : null}
        </form>
      </section>

      <section className="panel">
        <h2>3 · Search by meaning</h2>
        <form onSubmit={onSearch}>
          <label className="field" htmlFor="q">
            Query
          </label>
          <div className="search-row">
            <input
              id="q"
              name="q"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="e.g. stoneware vase · شمعدان · double breasted blazer"
              autoComplete="off"
            />
            <button type="submit" className="btn btn-primary" disabled={searching}>
              {searching ? (
                <>
                  <span className="spinner" aria-hidden /> Searching…
                </>
              ) : (
                "Search"
              )}
            </button>
          </div>
        </form>

        {pipeline && (query.trim() || pipeline.indexedDocuments > 0) ? (
          <div className="pipeline">
            <h3>Retrieval pipeline (5 stages)</h3>
            <ol>
              {pipeline.stages.map((s) => (
                <li key={s.key}>
                  <strong>{s.label}</strong>
                  <span>{s.detail}</span>
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </section>

      {results.length > 0 && (
        <section className="panel">
          <h2>4 · Results</h2>
          <ul className="results">
            {results.map((r, idx) => (
              <li key={`${r.id}-${idx}`} className="result-row">
                {r.primaryImage || r.meta?.primaryImage ? (
                  <img
                    className="thumb"
                    src={r.primaryImage || r.meta.primaryImage}
                    alt=""
                    width={80}
                    height={80}
                    loading="lazy"
                  />
                ) : null}
                <div className="result-body">
                  <div className="title">{r.label || r.id}</div>
                  <span className="idmuted">SKU {r.id}</span>
                  {r.styleCode || r.meta?.parentStyleCode ? (
                    <span className="idmuted"> · Style {r.styleCode || r.meta.parentStyleCode}</span>
                  ) : null}
                  <span className="score"> · score {r.score.toFixed(4)}</span>
                  {(r.productUrl || r.meta?.productUrl) && (
                    <div>
                      <a className="pdp" href={r.productUrl || r.meta.productUrl} target="_blank" rel="noopener noreferrer">
                        Open PDP (slug demo)
                      </a>
                    </div>
                  )}
                  {r.snippet ? <div className="snippet">{r.snippet}</div> : null}
                  {Object.keys(r.meta).length > 0 && (
                    <div className="meta">
                      {Object.entries(r.meta)
                        .filter(([k]) => !["primaryImage", "secondaryImages", "imageCount", "productUrl"].includes(k))
                        .slice(0, 6)
                        .map(([k, v]) => (
                          <span key={k}>
                            {k}: {v.length > 100 ? `${v.slice(0, 100)}…` : v}
                            {" · "}
                          </span>
                        ))}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="disclaimer">
        <strong>Note:</strong> This demo uses on-device TF–IDF (lexical “semantic” similarity). Hosted platforms like
        Denser add neural embeddings and a vector database; that path is an upgrade when APIs and budget are
        available. Arabic and English text are both tokenized after a recent fix — re-upload your CSV if search was
        empty before.
      </p>
    </div>
  );
}
