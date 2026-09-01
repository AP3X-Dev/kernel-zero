/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/require-await */
import { describe, expect, it, vi } from "vitest";

import { runSerializableTransaction } from "./transaction";

describe("serializable transaction boundary", () => {
  it("retries serialization conflicts at most three attempts with bounded delay", async () => {
    const conflict = Object.assign(new Error("serialization"), { code: "P2034" });
    const operation = vi.fn().mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict).mockResolvedValue("done");
    const sleep = vi.fn().mockResolvedValue(undefined);
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    await expect(runSerializableTransaction(client as never, operation, { jitter: () => 7, sleep })).resolves.toBe("done");
    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it("does not retry business errors", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("QUOTA_EXCEEDED"));
    const client = { $transaction: vi.fn(async (callback) => callback({})) };
    await expect(runSerializableTransaction(client as never, operation)).rejects.toThrow("QUOTA_EXCEEDED");
    expect(operation).toHaveBeenCalledTimes(1);
  });
});
