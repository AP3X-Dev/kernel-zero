import { randomBytes } from "node:crypto";

import { appError, type AppError } from "./errors";
import { err, ok, type Result } from "./result";

export type UuidV7 = string & { readonly __brand: "UuidV7" };

const UUID_V7_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function isUuidV7(value: unknown): value is UuidV7 {
  return typeof value === "string" && UUID_V7_PATTERN.test(value);
}

export function parseUuidV7(value: unknown): Result<UuidV7, AppError> {
  return isUuidV7(value)
    ? ok(value)
    : err(appError("VALIDATION_FAILED", { details: { field: "uuid" } }));
}

export function generateUuidV7(
  timestamp = Date.now(),
  random: (size: number) => Uint8Array = randomBytes,
): UuidV7 {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 0xffffffffffff) {
    throw new RangeError("UUIDv7 timestamp must fit in 48 unsigned bits.");
  }
  const bytes = new Uint8Array(16);
  let remaining = timestamp;
  for (let index = 5; index >= 0; index -= 1) {
    bytes[index] = remaining % 256;
    remaining = Math.floor(remaining / 256);
  }
  const entropy = random(10);
  if (entropy.length !== 10) throw new RangeError("UUIDv7 entropy source must return 10 bytes.");
  const first = entropy[0];
  const second = entropy[1];
  const third = entropy[2];
  if (first === undefined || second === undefined || third === undefined) {
    throw new RangeError("UUIDv7 entropy source returned incomplete bytes.");
  }
  bytes[6] = 0x70 | (first & 0x0f);
  bytes[7] = second;
  bytes[8] = 0x80 | (third & 0x3f);
  bytes.set(entropy.subarray(3), 9);
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UuidV7;
}
