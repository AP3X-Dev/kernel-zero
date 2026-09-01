/* eslint-disable @typescript-eslint/no-unsafe-return */
import { describe, expect, it, vi } from "vitest";

import {
  completeRequestLog,
  startRequestLog,
  type StructuredLogEvent,
} from "./request-log";

describe("correlated structured request logging", () => {
  it("uses one correlation ID for pre-handler and outcome logs without bodies or secrets", () => {
    const logger = { emit: vi.fn() };
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_025);
    const request = startRequestLog({
      actorId: "user-a",
      correlationCandidate: "0195f000-0000-7000-8000-000000000001",
      logger,
      now: clock,
      requestKind: "mutation",
      routeCategory: "application-api",
      workspaceId: "workspace-a",
    });
    completeRequestLog(request, { decisionCode: "ok", status: 200 });
    expect(logger.emit).toHaveBeenCalledTimes(2);
    const events = logger.emit.mock.calls.map((call) => call[0]) as StructuredLogEvent[];
    const started = events[0];
    const completed = events[1];
    expect(started).toBeDefined();
    expect(completed).toBeDefined();
    if (started === undefined || completed === undefined) throw new Error("Expected request log events.");
    expect(started.correlationId).toBe(completed.correlationId);
    expect(completed).toMatchObject({ decisionCode: "ok", durationMs: 25, status: 200 });
    expect(JSON.stringify([started, completed])).not.toMatch(/body|authorization|cookie|token/iu);
  });
});
