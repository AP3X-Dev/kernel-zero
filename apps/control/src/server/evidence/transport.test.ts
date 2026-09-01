import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { EvidenceIngressError, readEvidenceRequest } from "./transport";

const mediaType = "application/vnd.kernel-zero.evidence+json;version=1";

function request(body: BodyInit, headers: Record<string, string> = {}): Request {
  return new Request("https://example.invalid/api/evidence/v1/runs", {
    body,
    headers: { "content-type": mediaType, ...headers },
    method: "POST",
  });
}

describe("evidence ingress transport", () => {
  it("accepts identity and gzip JSON", async () => {
    await expect(readEvidenceRequest(request('{"kind":"RepositoryEvidence"}'))).resolves.toEqual({ kind: "RepositoryEvidence" });
    const compressed = gzipSync(Buffer.from('{"kind":"RepositoryEvidence"}'));
    await expect(readEvidenceRequest(request(compressed, { "content-encoding": "gzip" }))).resolves.toEqual({ kind: "RepositoryEvidence" });
  });

  it("uses 415 for unsupported media types and encodings", async () => {
    await expect(readEvidenceRequest(request("{}", { "content-encoding": "br" }))).rejects.toMatchObject({ status: 415 });
    await expect(readEvidenceRequest(request("{}", { "content-type": "application/json" }))).rejects.toMatchObject({ status: 415 });
  });

  it("enforces transferred and decompressed limits independently", async () => {
    await expect(readEvidenceRequest(request(new Uint8Array(33)), { transferLimitBytes: 32, decompressedLimitBytes: 64 })).rejects.toMatchObject({ status: 413, reason: "transfer_limit" });
    const compressed = gzipSync(Buffer.from(JSON.stringify({ value: "x".repeat(100) })));
    await expect(readEvidenceRequest(request(compressed, { "content-encoding": "gzip" }), { transferLimitBytes: 1_024, decompressedLimitBytes: 32 })).rejects.toMatchObject({ status: 413, reason: "decompressed_limit" });
  });

  it("rejects malformed gzip, UTF-8, and JSON as invalid evidence", async () => {
    const failures = [
      readEvidenceRequest(request(new Uint8Array([1, 2, 3]), { "content-encoding": "gzip" })),
      readEvidenceRequest(request(new Uint8Array([0xff]))),
      readEvidenceRequest(request("{")),
    ];
    for (const failure of failures) await expect(failure).rejects.toBeInstanceOf(EvidenceIngressError);
  });
});
