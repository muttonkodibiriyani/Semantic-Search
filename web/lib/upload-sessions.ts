import { randomUUID } from "crypto";
import { appendFile, stat, unlink, writeFile } from "fs/promises";
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

const sessions = new Map<string, UploadSession>();

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

async function gcStaleSessions(): Promise<void> {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.createdAt < SESSION_TTL_MS) continue;
    sessions.delete(id);
    try {
      await unlink(s.filePath);
    } catch {
      /* ignore */
    }
  }
}

export async function createUploadSession(
  filename: string,
  totalBytes: number,
  totalChunks: number
): Promise<{ uploadId: string }> {
  await gcStaleSessions();
  const uploadId = randomUUID();
  const filePath = path.join(os.tmpdir(), `semantic-search-${uploadId}.upload`);
  await writeFile(filePath, Buffer.alloc(0));
  sessions.set(uploadId, {
    filePath,
    nextChunkIndex: 0,
    totalChunks,
    totalBytes,
    bytesWritten: 0,
    filename,
    createdAt: Date.now()
  });
  return { uploadId };
}

export function getSession(uploadId: string): UploadSession | undefined {
  return sessions.get(uploadId);
}

export function removeSession(uploadId: string): void {
  sessions.delete(uploadId);
}

export async function appendChunk(
  uploadId: string,
  chunkIndex: number,
  data: Buffer
): Promise<{ ok: true; received: number; nextChunk: number } | { ok: false; error: string }> {
  const s = sessions.get(uploadId);
  if (!s) return { ok: false, error: "Unknown or expired upload session. Start upload again." };
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
  s.bytesWritten += data.length;
  s.nextChunkIndex += 1;
  return { ok: true, received: data.length, nextChunk: s.nextChunkIndex };
}

export async function verifyUploadComplete(uploadId: string): Promise<
  | { ok: true; session: UploadSession }
  | { ok: false; error: string }
> {
  const s = sessions.get(uploadId);
  if (!s) return { ok: false, error: "Unknown or expired upload session." };
  if (s.nextChunkIndex !== s.totalChunks) {
    return {
      ok: false,
      error: `Upload incomplete (${s.nextChunkIndex}/${s.totalChunks} chunks).`
    };
  }
  const st = await stat(s.filePath);
  if (st.size !== s.totalBytes) {
    return {
      ok: false,
      error: `Size mismatch (disk ${st.size} vs declared ${s.totalBytes}). Re-upload.`
    };
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
