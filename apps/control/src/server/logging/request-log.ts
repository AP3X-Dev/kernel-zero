import "server-only";

import { resolveCorrelationId, type CorrelationId } from "@kernel-zero/domain";

export type RequestKind = "query" | "mutation" | "webhook";

export type StructuredLogEvent = Readonly<{
  actorId?: string;
  correlationId: CorrelationId;
  decisionCode?: string;
  durationMs?: number;
  event: "request.started" | "request.completed";
  requestKind: RequestKind;
  routeCategory: string;
  status?: number;
  workspaceId?: string;
}>;

export type StructuredLogger = Readonly<{
  emit(event: StructuredLogEvent): void;
}>;

export type RequestLogContext = Readonly<{
  actorId?: string;
  correlationId: CorrelationId;
  logger: StructuredLogger;
  now: () => number;
  requestKind: RequestKind;
  routeCategory: string;
  startedAt: number;
  workspaceId?: string;
}>;

export function startRequestLog(input: Readonly<{
  actorId?: string;
  correlationCandidate?: unknown;
  logger: StructuredLogger;
  now?: () => number;
  requestKind: RequestKind;
  routeCategory: string;
  workspaceId?: string;
}>): RequestLogContext {
  const correlationId = resolveCorrelationId(input.correlationCandidate).id;
  const now = input.now ?? Date.now;
  const context: RequestLogContext = Object.freeze({
    ...(input.actorId === undefined ? {} : { actorId: input.actorId }),
    correlationId,
    logger: input.logger,
    now,
    requestKind: input.requestKind,
    routeCategory: input.routeCategory,
    startedAt: now(),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
  });
  context.logger.emit(eventFrom(context, { event: "request.started" }));
  return context;
}

export function completeRequestLog(
  context: RequestLogContext,
  outcome: Readonly<{ decisionCode: string; status: number }>,
): void {
  context.logger.emit(eventFrom(context, {
    decisionCode: outcome.decisionCode,
    durationMs: Math.max(0, context.now() - context.startedAt),
    event: "request.completed",
    status: outcome.status,
  }));
}

function eventFrom(
  context: RequestLogContext,
  fields: Readonly<{
    decisionCode?: string;
    durationMs?: number;
    event: StructuredLogEvent["event"];
    status?: number;
  }>,
): StructuredLogEvent {
  return Object.freeze({
    ...(context.actorId === undefined ? {} : { actorId: context.actorId }),
    correlationId: context.correlationId,
    ...fields,
    requestKind: context.requestKind,
    routeCategory: context.routeCategory,
    ...(context.workspaceId === undefined ? {} : { workspaceId: context.workspaceId }),
  });
}
