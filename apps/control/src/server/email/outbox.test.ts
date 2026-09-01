import "server-only";

import { describe, expect, it } from "vitest";

import { DEVELOPMENT_OUTBOX_LIMIT, DevelopmentOutbox } from "./outbox";

function action(index: number) {
  return {
    actionUrl: `http://127.0.0.1:3000/join/token-${String(index)}`,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    kind: "invitation" as const,
    recipient: `person-${String(index)}@example.test`,
  };
}

describe("bounded one-shot development outbox", () => {
  it("drains exactly once", () => {
    const outbox = new DevelopmentOutbox("development");
    expect(outbox.enqueue(action(1)).ok).toBe(true);
    expect(outbox.takeAll()).toHaveLength(1);
    expect(outbox.takeAll()).toEqual([]);
  });

  it("never exposes actions in production", () => {
    const outbox = new DevelopmentOutbox("production");
    expect(outbox.enqueue(action(1))).toMatchObject({
      error: { code: "FEATURE_UNAVAILABLE" },
      ok: false,
    });
    expect(outbox.takeAll()).toEqual([]);
  });

  it("caps the local outbox without evicting an unseen action", () => {
    const outbox = new DevelopmentOutbox("test");
    for (let index = 0; index < DEVELOPMENT_OUTBOX_LIMIT; index += 1) {
      expect(outbox.enqueue(action(index)).ok).toBe(true);
    }
    expect(outbox.enqueue(action(DEVELOPMENT_OUTBOX_LIMIT))).toMatchObject({
      error: { code: "QUOTA_EXCEEDED" },
      ok: false,
    });
    expect(outbox.size).toBe(DEVELOPMENT_OUTBOX_LIMIT);
  });
});
