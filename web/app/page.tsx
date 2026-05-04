"use client";

import { useCallback, useEffect, useState } from "react";

const MAX_SINGLE_UPLOAD_BYTES = 4 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;

type Hit = {
  id: string;
  score: number;
  label?: string;
  snippet?: string;
  meta: Record<string, string>;
};

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Hit[]>([]);
  const [docCount, setDocCount] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const refreshStats = useCallback(async () => {
    const res = await fetch("/api/stats");
    const j = (await res.json()) as { documents: number };
    setDocCount(j.documents);
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
    if (!initRes.ok) {
      throw new Error(initJson.error || "Could not start upload.");
    }
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
        headers: {
          "x-upload-id": uploadId,
          "x-chunk-index": String(i)
        },
        body: buf
      });
      const chunkJson = (await chunkRes.json()) as { error?: string };
      if (!chunkRes.ok) {
        throw new Error(chunkJson.error || `Chunk ${i} failed.`);
      }
    }

    setUploadPhase("Indexing on server (this can take several minutes for huge files)…");
    const doneRes = await fetch("/api/ingest/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ uploadId })
    });
    const doneJson = (await doneRes.json()) as {
      ok?: boolean;
      indexed?: number;
      warning?: string;
      truncated?: boolean;
      error?: string;
    };
    if (!doneRes.ok) {
      throw new Error(doneJson.error || "Indexing failed after upload.");
    }
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
      throw new Error(j.error || "Upload failed.");
    }
    return `Indexed ${j.indexed ?? 0} rows.`;
  };

  const loadSafeDemo = async () => {
    setMessage(null);
    setUploadPhase(null);
    setUploading(true);
    try {
      const res = await fetch("/demo/sample-products.csv");
      if (!res.ok) throw new Error("Demo file missing from deployment.");
      const blob = await res.blob();
      const file = new File([blob], "sample-products.csv", { type: "text/csv" });
      const msg = await uploadSmall(file);
      setMessage(`${msg} (synthetic demo only — not your proprietary data.)`);
      await refreshStats();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not load demo.");
    } finally {
      setUploading(false);
    }
  };

  const onUpload = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage(null);
    setUploadPhase(null);
    const form = e.currentTarget;
    const input = form.elements.namedItem("file") as HTMLInputElement;
    const file = input?.files?.[0];
    if (!file) {
      setMessage("Choose a .csv, .tsv, .json, or .jsonl file first.");
      return;
    }
    setUploading(true);
    try {
      const msg =
        file.size > MAX_SINGLE_UPLOAD_BYTES ? await uploadChunked(file) : await uploadSmall(file);
      setMessage(msg);
      setUploadPhase(null);
      await refreshStats();
    } catch (err) {
      setUploadPhase(null);
      setMessage(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const onSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setMessage(null);
    const q = query.trim();
    if (!q) {
      setResults([]);
      return;
    }
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const j = (await res.json()) as { results: Hit[] };
    setResults(j.results || []);
    if (!j.results?.length) {
      setMessage("No matches (try other words, or confirm the catalog finished indexing).");
    }
  };

  return (
    <main>
      <h1>Semantic product search</h1>
      <p className="lead">
        Open this app at <strong>http://127.0.0.1:3200</strong> (run <code>npm run dev</code> from the{" "}
        <code>semantic-search/web</code> folder). Large files (hundreds of MB) upload in parts, then stream into the
        index — no single 900MB request.
      </p>

      <section className="tips">
        <strong>Tips for huge catalogs</strong>
        <ul>
          <li>
            Prefer <strong>CSV</strong> or <strong>JSON Lines (.jsonl)</strong> — one JSON object per line. A single
            giant <code>.json</code> array over ~80MB is rejected (convert to .jsonl).
          </li>
          <li>
            If Node runs out of memory while indexing, restart dev with more heap, for example:{" "}
            <code>set NODE_OPTIONS=--max-old-space-size=16384</code> then <code>npm run dev</code> (PowerShell:{" "}
            <code>$env:NODE_OPTIONS=&quot;--max-old-space-size=16384&quot;</code>).
          </li>
          <li>
            Optional cap: set env <code>SEMANTIC_SEARCH_MAX_ROWS</code> to limit rows (useful for testing).
          </li>
        </ul>
      </section>

      <section>
        <p className="lead" style={{ marginBottom: "0.75rem" }}>
          <button type="button" className="secondary" onClick={() => void loadSafeDemo()} disabled={uploading}>
            Load safe demo catalog
          </button>{" "}
          <span className="demohint">Tiny public sample for manager demos — no upload of your file.</span>
        </p>
        <form onSubmit={onUpload}>
          <label htmlFor="file">Catalog file (.csv, .tsv, .json, .jsonl)</label>
          <input
            id="file"
            name="file"
            type="file"
            accept=".csv,.tsv,.json,.jsonl,.ndjson,text/csv,application/json"
          />
          <button type="submit" disabled={uploading}>
            {uploading ? "Working…" : "Upload & index"}
          </button>
          <p className="status">
            Indexed documents: {docCount === null ? "…" : docCount}
            {uploadPhase ? (
              <>
                <br />
                <span className="phase">{uploadPhase}</span>
              </>
            ) : null}
            {message ? (
              <>
                <br />
                <span className="msg">{message}</span>
              </>
            ) : null}
          </p>
        </form>
      </section>

      <section>
        <form onSubmit={onSearch}>
          <label htmlFor="q">Search</label>
          <input
            id="q"
            name="q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="e.g. waterproof backpack bluetooth"
            autoComplete="off"
          />
          <button type="submit">Search</button>
        </form>
      </section>

      {results.length > 0 && (
        <section>
          <h2 style={{ fontSize: "1rem", margin: "0 0 0.75rem" }}>Results</h2>
          <ul className="results">
            {results.map((r, idx) => (
              <li key={`${r.id}-${idx}`}>
                <strong>{r.label || r.id}</strong>
                <span className="idmuted"> ({r.id})</span>
                <span className="score"> · score {r.score.toFixed(4)}</span>
                {r.snippet ? <div className="snippet">{r.snippet}</div> : null}
                {Object.keys(r.meta).length > 0 && (
                  <div className="meta">
                    {Object.entries(r.meta)
                      .slice(0, 8)
                      .map(([k, v]) => (
                        <span key={k}>
                          {k}: {v.length > 120 ? `${v.slice(0, 120)}…` : v}
                          {" · "}
                        </span>
                      ))}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
