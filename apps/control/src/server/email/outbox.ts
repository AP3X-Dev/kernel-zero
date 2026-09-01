import "server-only";

import { appError, err, ok, type AppError, type Result } from "@kernel-zero/domain";

import type { RuntimeEnvironment } from "../config/config";

export const DEVELOPMENT_OUTBOX_LIMIT = 50;

export type DevelopmentAction = Readonly<{
  actionUrl: string;
  createdAt: Date;
  kind: "invitation" | "password-reset" | "verification";
  recipient: string;
}>;

function isLocalActionUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
    );
  } catch {
    return false;
  }
}

export class DevelopmentOutbox {
  readonly #environment: RuntimeEnvironment;
  readonly #items: DevelopmentAction[] = [];

  constructor(environment: RuntimeEnvironment) {
    this.#environment = environment;
  }

  enqueue(action: DevelopmentAction): Result<void, AppError> {
    if (this.#environment === "production") return err(appError("FEATURE_UNAVAILABLE"));
    if (this.#items.length >= DEVELOPMENT_OUTBOX_LIMIT) {
      return err(appError("QUOTA_EXCEEDED", { details: { limit: DEVELOPMENT_OUTBOX_LIMIT } }));
    }
    if (!isLocalActionUrl(action.actionUrl)) {
      return err(appError("VALIDATION_FAILED", { details: { field: "actionUrl" } }));
    }
    if (action.recipient.length < 3 || action.recipient.length > 320) {
      return err(appError("VALIDATION_FAILED", { details: { field: "recipient" } }));
    }
    this.#items.push(Object.freeze({ ...action, createdAt: new Date(action.createdAt) }));
    return ok(undefined);
  }

  takeAll(): readonly DevelopmentAction[] {
    if (this.#environment === "production") return [];
    const items = this.#items.splice(0, this.#items.length);
    return Object.freeze(items);
  }

  get size(): number {
    return this.#items.length;
  }
}
