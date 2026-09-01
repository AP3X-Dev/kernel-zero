import "server-only";

import { gunzipSync } from "node:zlib";

import { EVIDENCE_MEDIA_TYPE } from "@kernel-zero/contracts";

import { EvidenceIngressError, invalidEvidence } from "./errors";

export { EvidenceIngressError } from "./errors";

export const EVIDENCE_TRANSFER_LIMIT_BYTES = 2 * 1024 * 1024;
export const EVIDENCE_DECOMPRESSED_LIMIT_BYTES = 8 * 1024 * 1024;

type EvidenceRequestLimits = Readonly<{
  decompressedLimitBytes?: number;
  transferLimitBytes?: number;
}>;

export async function readEvidenceRequest(request: Request, limits: EvidenceRequestLimits = {}): Promise<unknown> {
  const transferLimitBytes = limits.transferLimitBytes ?? EVIDENCE_TRANSFER_LIMIT_BYTES;
  const decompressedLimitBytes = limits.decompressedLimitBytes ?? EVIDENCE_DECOMPRESSED_LIMIT_BYTES;
  const mediaType = request.headers.get("content-type")?.trim().toLowerCase();
  if (mediaType !== EVIDENCE_MEDIA_TYPE) {
    throw new EvidenceIngressError(415, "INVALID_EVIDENCE", "unsupported_media_type");
  }

  const encoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
  if (encoding !== "identity" && encoding !== "gzip") {
    throw new EvidenceIngressError(415, "INVALID_EVIDENCE", "unsupported_content_encoding");
  }

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const length = Number(declaredLength);
    if (!Number.isSafeInteger(length) || length < 0) throw invalidEvidence("invalid_content_length");
    if (length > transferLimitBytes) throw invalidEvidence("transfer_limit", 413);
  }

  const transferred = await readLimitedBody(request, transferLimitBytes);
  let bytes: Uint8Array;
  if (encoding === "gzip") {
    try {
      bytes = gunzipSync(transferred, { maxOutputLength: decompressedLimitBytes });
    } catch (error) {
      if (isOutputLimitError(error)) throw invalidEvidence("decompressed_limit", 413);
      throw invalidEvidence("invalid_gzip");
    }
  } else {
    bytes = transferred;
  }
  if (bytes.byteLength > decompressedLimitBytes) throw invalidEvidence("decompressed_limit", 413);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw invalidEvidence("invalid_utf8");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw invalidEvidence("invalid_json");
  }
}

async function readLimitedBody(request: Request, limit: number): Promise<Uint8Array> {
  if (request.body === null) throw invalidEvidence("empty_body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let read = await reader.read();
  while (!read.done) {
    const { value } = read;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw invalidEvidence("transfer_limit", 413);
    }
    chunks.push(value);
    read = await reader.read();
  }
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function isOutputLimitError(error: unknown): boolean {
  return error instanceof RangeError || (typeof error === "object" && error !== null && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE");
}
