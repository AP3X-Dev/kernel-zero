import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "./canonical";

export type Sha256Digest = `sha256:${string}`;
const SHA256_PATTERN = /^sha256:[0-9a-f]{64}$/u;

export function sha256Bytes(value: string | Uint8Array): Uint8Array {
  return createHash("sha256").update(value).digest();
}

export function sha256(value: string | Uint8Array): Sha256Digest {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalSha256(value: JsonValue): Sha256Digest {
  return sha256(canonicalJson(value));
}

export function isSha256Digest(value: unknown): value is Sha256Digest {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

export function digestBytes(digest: Sha256Digest): Uint8Array {
  if (!isSha256Digest(digest)) throw new TypeError("Invalid SHA-256 digest.");
  return Uint8Array.from(Buffer.from(digest.slice("sha256:".length), "hex"));
}
