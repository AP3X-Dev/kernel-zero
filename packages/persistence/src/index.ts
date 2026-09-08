import "server-only";

export { createPersistenceClient, inTransaction } from "./client";
export type { PersistenceClient, TransactionClient } from "./client";
export { mapKnownPersistenceError, PersistenceConstraintError } from "./constraint-errors";
export {
  createAuditRepository,
  SAFE_AUDIT_SELECT,
  validateAuditRecord,
} from "./audit";
export type {
  AuditActor,
  AuditMetadata,
  AuditRecordInput,
  SafeAuditRecord,
  TransactionAuditRepository,
} from "./audit";
export {
  isSerializationConflict,
  runSerializableTransaction,
  transactionRepositorySet,
} from "./transaction";
export type {
  SerializableTransactionOptions,
  TransactionRepositorySet,
} from "./transaction";
export { tenantSelector } from "./tenancy";
export {
  activatePolicyRevision,
  approvePolicyRevision,
  createPolicyPack,
  retirePolicyPack,
  savePolicyDraft,
} from "./policies";
export {
  decideException,
  isExceptionApplicable,
  requestException,
  revokeException,
} from "./exceptions";
export {
  exportExceptionGrantSet,
  normalizeEd25519PublicKey,
  registerSigningKey,
  revokeSigningKey,
} from "./signing-keys";
export {
  deleteExpiredEvidence,
  listEvidenceFindings,
  listEvidenceRuns,
  StoredEvidenceSchema,
  storeEvidenceRun,
} from "./evidence";
export type {
  EvidenceAttestationState,
  EvidenceFindingFilters,
  EvidenceFindingReview,
  EvidencePage,
  EvidenceResultStatus,
  EvidenceRetentionInput,
  EvidenceRetentionSummary,
  EvidenceRunFilters,
  EvidenceRunReview,
  FindingExceptionState,
  StoredEvidence,
  StoreEvidenceRunInput,
  StoreEvidenceRunResult,
} from "./evidence";
