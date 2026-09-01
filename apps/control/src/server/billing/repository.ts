import "server-only";

import {
  markTrialUsed,
  readDowngradeUsage,
  readTrialEligibility,
  readWorkspaceBilling,
  type PersistenceClient,
} from "@kernel-zero/persistence";

import type { BillingRepository } from "./types";

export function createBillingRepository(client: PersistenceClient): BillingRepository {
  return Object.freeze({
    findWorkspaceBilling: (workspaceId) => readWorkspaceBilling(client, workspaceId),
    markTrialUsed: (input) => markTrialUsed(client, input.userId, input.fingerprint),
    readDowngradeUsage: (workspaceId) => readDowngradeUsage(client, workspaceId),
    readTrialEligibility: (input) => readTrialEligibility(client, input.userId, input.fingerprint),
  });
}
