import { randomUUID } from "crypto";
import { appendFile, mkdir, readdir, readFile, stat, unlink, writeFile } from "fs/promises";
import path from "path";
import os from "os";

export type UploadSession = {
  filePath: string;
  nextChunkIndex: number;
  totalChunks: number;
  totalBytes: number;
  bytesWritten: number;
  filename: string;
  createdAt: number;
};

/** All chunk state lives on disk so it survives dev HMR and single-node restarts (in-memory Map did not). */
const SESSION_DIR = path.join(os.tmpdir(), "semantic-search-uploads");
const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function metaPath(uploadId: string): string {
  return path.join(SESSION_DIR, `${uploadId}.meta.json`);
}

function dataPath(uploadId: string): string {
  return path.join(SESSION_DIR, `${uploadId}.part`);
}

async function readSession(uploadId: string): Promise<UploadSession | undefined> {
  try {
    const raw = await readFile(metaPath(uploadId), "utf8");
    return JSON.parse(raw) as UploadSession;
  } catch {
    return undefined;
  }
}

async function writeSession(uploadId: string, session: UploadSession): Promise<void> {
  await writeFile(metaPath(uploadId), JSON.stringify(session), "utf8");
}

async function gcStaleSessions(): Promise<void> {
  let names: string[];
  try {
    names = await readdir(SESSION_DIR);
  } catch {
    return;
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".meta.json")) continue;
    const uploadId = name.replace(/\.meta\.json$/i, "");
    const s = await readSession(uploadId);
    if (!s) continue;
    if (now - s.createdAt < SESSION_TTL_MS) continue;
    await removeSession(uploadId);
  }
}

export async function createUploadSession(
  filename: string,
  totalBytes: number,
  totalChunks: number
): Promise<{ uploadId: string }> {
  await mkdir(SESSION_DIR, { recursive: true });
  await gcStaleSessions();
  const uploadId = randomUUID();
  const filePath = dataPath(uploadId);
  await writeFile(filePath, Buffer.alloc(0));
  const session: UploadSession = {
    filePath,
    nextChunkIndex: 0,
    totalChunks,
    totalBytes,
    bytesWritten: 0,
    filename,
    createdAt: Date.now()
  };
  await writeSession(uploadId, session);
  return { uploadId };
}

export async function removeSession(uploadId: string): Promise<void> {
  try {
    await unlink(metaPath(uploadId));
  } catch {
    /* ignore */
  }
  try {
    await unlink(dataPath(uploadId));
  } catch {
    /* ignore */
  }
}

export async function appendChunk(
  uploadId: string,
  chunkIndex: number,
  data: Buffer
): Promise<{ ok: true; received: number; nextChunk: number } | { ok: false; error: string }> {
  const s = await readSession(uploadId);
  if (!s) {
    return {
      ok: false,
      error:
        "Unknown or expired upload session. If you are on Vercel, large files need BLOB_READ_WRITE_TOKEN (see README) or run the app locally."
    };
  }
  if (chunkIndex !== s.nextChunkIndex) {
    return {
      ok: false,
      error: `Chunks must be sent in order (expected ${s.nextChunkIndex}, got ${chunkIndex}).`
    };
  }
  if (chunkIndex >= s.totalChunks) {
    return { ok: false, error: "Chunk index out of range." };
  }
  await appendFile(s.filePath, data);
  const next: UploadSession = {
    ...s,
    bytesWritten: s.bytesWritten + data.length,
    nextChunkIndex: s.nextChunkIndex + 1
  };
  await writeSession(uploadId, next);
  return { ok: true, received: data.length, nextChunk: next.nextChunkIndex };
}

export async function verifyUploadComplete(
  uploadId: string
): Promise<{ ok: true; session: UploadSession } | { ok: false; error: string }> {
  const s = await readSession(uploadId);
  if (!s) {
    return {
      ok: false,
      error:
        "Unknown or expired upload session. If you are on Vercel, use Blob storage for large uploads or run locally."
    };
  }
  if (s.nextChunkIndex !== s.totalChunks) {
    return {
      ok: false,
      error: `Upload incomplete (${s.nextChunkIndex}/${s.totalChunks} chunks).`
    };
  }
  try {
    const st = await stat(s.filePath);
    if (st.size !== s.totalBytes) {
      return {
        ok: false,
        error: `Size mismatch (disk ${st.size} vs declared ${s.totalBytes}). Re-upload.`
      };
    }
  } catch {
    return { ok: false, error: "Upload file missing on server. Re-upload." };
  }
  return { ok: true, session: s };
}

export async function deleteUploadFile(filePath: string): Promise<void> {
  try {
    await unlink(filePath);
  } catch {
    /* ignore */
  }
}
