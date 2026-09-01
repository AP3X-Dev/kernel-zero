-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OnboardingState" AS ENUM ('pending', 'complete');

-- CreateEnum
CREATE TYPE "RoleQuarantineState" AS ENUM ('valid', 'quarantined');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('active', 'accepted', 'cancelled', 'expired');

-- CreateEnum
CREATE TYPE "DeliveryState" AS ENUM ('pending', 'sent', 'failed');

-- CreateEnum
CREATE TYPE "PolicyPackState" AS ENUM ('draft', 'active', 'retired');

-- CreateEnum
CREATE TYPE "PolicyRevisionState" AS ENUM ('draft', 'approved', 'active', 'superseded');

-- CreateEnum
CREATE TYPE "ExceptionDecisionState" AS ENUM ('pending', 'approved', 'denied');

-- CreateEnum
CREATE TYPE "EvidenceStatus" AS ENUM ('pass', 'fail', 'error');

-- CreateEnum
CREATE TYPE "FindingLevel" AS ENUM ('error', 'warning');

-- CreateEnum
CREATE TYPE "AttestationState" AS ENUM ('recorded', 'attested');

-- CreateEnum
CREATE TYPE "EntitlementState" AS ENUM ('open', 'paid', 'grace');

-- CreateEnum
CREATE TYPE "PaymentReceiptState" AS ENUM ('received', 'applied', 'stale', 'quarantined', 'ignored');

-- CreateEnum
CREATE TYPE "AuditActorKind" AS ENUM ('user', 'system');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "normalizedEmail" VARCHAR(320) NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" VARCHAR(2048),
    "onboardingState" "OnboardingState" NOT NULL DEFAULT 'pending',
    "trialUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "accountId" VARCHAR(255) NOT NULL,
    "providerId" VARCHAR(100) NOT NULL,
    "userId" UUID NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ(3),
    "refreshTokenExpiresAt" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "userId" UUID NOT NULL,
    "selectedWorkspaceId" UUID,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "ipAddress" VARCHAR(128),
    "userAgent" VARCHAR(1024),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" UUID NOT NULL,
    "identifier" VARCHAR(320) NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" UUID NOT NULL,
    "slug" VARCHAR(48) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "logoUrl" VARCHAR(2048),
    "ownerMembershipId" UUID NOT NULL,
    "stripeCustomerId" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roleProfileId" UUID,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleProfile" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "normalizedLabel" VARCHAR(80) NOT NULL,
    "displayLabel" VARCHAR(80) NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "capabilityDocument" JSONB NOT NULL,
    "quarantineState" "RoleQuarantineState" NOT NULL DEFAULT 'valid',
    "builtIn" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RoleProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "normalizedEmail" VARCHAR(320) NOT NULL,
    "displayEmail" VARCHAR(320) NOT NULL,
    "roleProfileId" UUID NOT NULL,
    "creatorId" UUID NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "InvitationStatus" NOT NULL DEFAULT 'active',
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "deliveryState" "DeliveryState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyPack" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "displayName" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "lifecycleState" "PolicyPackState" NOT NULL DEFAULT 'draft',
    "activeRevisionId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PolicyPack_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PolicyRevision" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "packId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "authorId" UUID NOT NULL,
    "canonicalJson" TEXT NOT NULL,
    "digest" CHAR(71),
    "state" "PolicyRevisionState" NOT NULL DEFAULT 'draft',
    "approverId" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PolicyRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExceptionRequest" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "policyDigest" CHAR(71) NOT NULL,
    "ruleId" VARCHAR(80) NOT NULL,
    "findingFingerprint" CHAR(71) NOT NULL,
    "rationale" VARCHAR(2000) NOT NULL,
    "issueUrl" VARCHAR(2048),
    "requesterId" UUID NOT NULL,
    "decisionState" "ExceptionDecisionState" NOT NULL DEFAULT 'pending',
    "deciderId" UUID,
    "decisionNote" VARCHAR(2000),
    "validUntil" TIMESTAMPTZ(3) NOT NULL,
    "decidedAt" TIMESTAMPTZ(3),
    "revokedAt" TIMESTAMPTZ(3),
    "revokedById" UUID,
    "revocationReason" VARCHAR(1000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ExceptionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SigningKey" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "keyId" VARCHAR(120) NOT NULL,
    "publicKey" TEXT NOT NULL,
    "label" VARCHAR(120) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "creatorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SigningKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceRun" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "policyDigest" CHAR(71) NOT NULL,
    "repositoryLabel" VARCHAR(200) NOT NULL,
    "revisionLabel" VARCHAR(200) NOT NULL,
    "toolVersion" VARCHAR(100) NOT NULL,
    "generatedAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "EvidenceStatus" NOT NULL,
    "errorCount" INTEGER NOT NULL,
    "warningCount" INTEGER NOT NULL,
    "exceptedCount" INTEGER NOT NULL,
    "filesScanned" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "manifestDigest" CHAR(71) NOT NULL,
    "integrityDigest" CHAR(71) NOT NULL,
    "signatureKeyId" VARCHAR(120),
    "signatureValue" TEXT,
    "exceptionBundleDigest" CHAR(71),
    "attestationState" "AttestationState" NOT NULL DEFAULT 'recorded',
    "submitterId" UUID NOT NULL,
    "correlationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Finding" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "evidenceRunId" UUID NOT NULL,
    "findingId" CHAR(71) NOT NULL,
    "fingerprint" CHAR(71) NOT NULL,
    "ruleId" VARCHAR(80) NOT NULL,
    "level" "FindingLevel" NOT NULL,
    "messageCode" VARCHAR(80) NOT NULL,
    "message" VARCHAR(500) NOT NULL,
    "subject" VARCHAR(500) NOT NULL,
    "path" VARCHAR(1000) NOT NULL,
    "startLine" INTEGER NOT NULL,
    "startColumn" INTEGER NOT NULL,
    "endLine" INTEGER NOT NULL,
    "endColumn" INTEGER NOT NULL,
    "exceptionRequestId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Finding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuotaCounter" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "quotaKey" VARCHAR(80) NOT NULL,
    "periodKey" VARCHAR(80) NOT NULL,
    "used" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "QuotaCounter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionProjection" (
    "id" UUID NOT NULL,
    "workspaceId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL DEFAULT 'stripe',
    "customerId" VARCHAR(255),
    "subscriptionId" VARCHAR(255),
    "priceId" VARCHAR(255),
    "plan" VARCHAR(40) NOT NULL,
    "providerStatus" VARCHAR(80) NOT NULL,
    "entitlementState" "EntitlementState" NOT NULL DEFAULT 'open',
    "currentPeriodStart" TIMESTAMPTZ(3),
    "currentPeriodEnd" TIMESTAMPTZ(3),
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "graceExpiresAt" TIMESTAMPTZ(3),
    "lastProviderCreatedAt" TIMESTAMPTZ(3),
    "lastProviderEventId" VARCHAR(255),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SubscriptionProjection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEventReceipt" (
    "id" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "eventId" VARCHAR(255) NOT NULL,
    "providerCreatedAt" TIMESTAMPTZ(3) NOT NULL,
    "payloadDigest" CHAR(71) NOT NULL,
    "eventType" VARCHAR(120) NOT NULL,
    "workspaceId" UUID,
    "replayFields" JSONB NOT NULL,
    "state" "PaymentReceiptState" NOT NULL DEFAULT 'received',
    "quarantineReason" VARCHAR(500),
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "projectionResult" VARCHAR(500),
    "correlationId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PaymentEventReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrialFingerprint" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "fingerprintHash" CHAR(71) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TrialFingerprint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditRecord" (
    "id" UUID NOT NULL,
    "workspaceOpaqueId" UUID NOT NULL,
    "actorKind" "AuditActorKind" NOT NULL,
    "actorUserId" UUID,
    "systemActorRef" VARCHAR(120),
    "actionCode" VARCHAR(120) NOT NULL,
    "subjectType" VARCHAR(120) NOT NULL,
    "subjectId" VARCHAR(255) NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "metadata" JSONB NOT NULL,
    "correlationId" UUID NOT NULL,
    "clientAddressHint" VARCHAR(128),
    "userAgentHint" VARCHAR(1024),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemOperatorGrant" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" VARCHAR(40) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "SystemOperatorGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_normalizedEmail_key" ON "User"("normalizedEmail");

-- CreateIndex
CREATE INDEX "account_user_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_provider_account_key" ON "Account"("providerId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "session_user_expiry_idx" ON "Session"("userId", "expiresAt");

-- CreateIndex
CREATE INDEX "verification_identifier_expiry_idx" ON "Verification"("identifier", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_ownerMembershipId_key" ON "Workspace"("ownerMembershipId");

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_stripeCustomerId_key" ON "Workspace"("stripeCustomerId");

-- CreateIndex
CREATE INDEX "membership_user_joined_idx" ON "Membership"("userId", "joinedAt");

-- CreateIndex
CREATE INDEX "membership_workspace_role_idx" ON "Membership"("workspaceId", "roleProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_workspace_user_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "membership_workspace_id_key" ON "Membership"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "role_profile_workspace_label_key" ON "RoleProfile"("workspaceId", "normalizedLabel");

-- CreateIndex
CREATE UNIQUE INDEX "role_profile_workspace_id_key" ON "RoleProfile"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_tokenHash_key" ON "Invitation"("tokenHash");

-- CreateIndex
CREATE INDEX "invitation_workspace_status_idx" ON "Invitation"("workspaceId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "invitation_email_status_idx" ON "Invitation"("normalizedEmail", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PolicyPack_activeRevisionId_key" ON "PolicyPack"("activeRevisionId");

-- CreateIndex
CREATE INDEX "policy_pack_workspace_state_idx" ON "PolicyPack"("workspaceId", "lifecycleState", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "policy_pack_workspace_slug_key" ON "PolicyPack"("workspaceId", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "policy_pack_workspace_id_key" ON "PolicyPack"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "policy_revision_workspace_state_idx" ON "PolicyRevision"("workspaceId", "state", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_pack_revision_key" ON "PolicyRevision"("packId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_workspace_digest_key" ON "PolicyRevision"("workspaceId", "digest");

-- CreateIndex
CREATE UNIQUE INDEX "policy_revision_pack_id_key" ON "PolicyRevision"("packId", "id");

-- CreateIndex
CREATE INDEX "exception_workspace_state_expiry_idx" ON "ExceptionRequest"("workspaceId", "decisionState", "validUntil");

-- CreateIndex
CREATE INDEX "exception_match_idx" ON "ExceptionRequest"("workspaceId", "policyDigest", "ruleId", "findingFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "exception_workspace_id_key" ON "ExceptionRequest"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "signing_key_workspace_active_idx" ON "SigningKey"("workspaceId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "signing_key_workspace_key_key" ON "SigningKey"("workspaceId", "keyId");

-- CreateIndex
CREATE INDEX "evidence_run_workspace_generated_idx" ON "EvidenceRun"("workspaceId", "generatedAt");

-- CreateIndex
CREATE INDEX "evidence_run_policy_status_idx" ON "EvidenceRun"("workspaceId", "policyDigest", "status");

-- CreateIndex
CREATE INDEX "evidence_run_repo_generated_idx" ON "EvidenceRun"("workspaceId", "repositoryLabel", "generatedAt", "id");

-- CreateIndex
CREATE INDEX "evidence_run_result_attestation_idx" ON "EvidenceRun"("workspaceId", "status", "attestationState", "generatedAt", "id");

-- CreateIndex
CREATE INDEX "evidence_run_submitter_generated_idx" ON "EvidenceRun"("workspaceId", "submitterId", "generatedAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_run_workspace_run_key" ON "EvidenceRun"("workspaceId", "runId");

-- CreateIndex
CREATE UNIQUE INDEX "evidence_run_workspace_id_key" ON "EvidenceRun"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_rule_level_idx" ON "Finding"("workspaceId", "ruleId", "level");

-- CreateIndex
CREATE INDEX "finding_run_path_idx" ON "Finding"("evidenceRunId", "path");

-- CreateIndex
CREATE INDEX "finding_workspace_run_rule_level_idx" ON "Finding"("workspaceId", "evidenceRunId", "ruleId", "level", "createdAt", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_path_idx" ON "Finding"("workspaceId", "path", "createdAt", "id");

-- CreateIndex
CREATE INDEX "finding_workspace_exception_idx" ON "Finding"("workspaceId", "exceptionRequestId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "finding_run_finding_key" ON "Finding"("evidenceRunId", "findingId");

-- CreateIndex
CREATE UNIQUE INDEX "quota_counter_scope_key" ON "QuotaCounter"("workspaceId", "quotaKey", "periodKey");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionProjection_workspaceId_key" ON "SubscriptionProjection"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionProjection_subscriptionId_key" ON "SubscriptionProjection"("subscriptionId");

-- CreateIndex
CREATE INDEX "subscription_provider_customer_idx" ON "SubscriptionProjection"("provider", "customerId");

-- CreateIndex
CREATE INDEX "payment_event_state_created_idx" ON "PaymentEventReceipt"("state", "providerCreatedAt");

-- CreateIndex
CREATE INDEX "payment_event_workspace_created_idx" ON "PaymentEventReceipt"("workspaceId", "providerCreatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_event_provider_event_key" ON "PaymentEventReceipt"("provider", "eventId");

-- CreateIndex
CREATE INDEX "trial_fingerprint_hash_idx" ON "TrialFingerprint"("fingerprintHash");

-- CreateIndex
CREATE UNIQUE INDEX "trial_fingerprint_user_hash_key" ON "TrialFingerprint"("userId", "fingerprintHash");

-- CreateIndex
CREATE INDEX "audit_workspace_created_idx" ON "AuditRecord"("workspaceOpaqueId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_actor_created_idx" ON "AuditRecord"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_action_created_idx" ON "AuditRecord"("actionCode", "createdAt");

-- CreateIndex
CREATE INDEX "audit_subject_created_idx" ON "AuditRecord"("subjectType", "subjectId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SystemOperatorGrant_userId_key" ON "SystemOperatorGrant"("userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerMembershipId_fkey" FOREIGN KEY ("ownerMembershipId") REFERENCES "Membership"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleProfile" ADD CONSTRAINT "RoleProfile_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleProfileId_fkey" FOREIGN KEY ("roleProfileId") REFERENCES "RoleProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPack" ADD CONSTRAINT "PolicyPack_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyPack" ADD CONSTRAINT "PolicyPack_activeRevisionId_fkey" FOREIGN KEY ("activeRevisionId") REFERENCES "PolicyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_packId_fkey" FOREIGN KEY ("packId") REFERENCES "PolicyPack"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "PolicyRevision_approverId_fkey" FOREIGN KEY ("approverId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_requesterId_fkey" FOREIGN KEY ("requesterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_deciderId_fkey" FOREIGN KEY ("deciderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "ExceptionRequest_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningKey" ADD CONSTRAINT "SigningKey_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SigningKey" ADD CONSTRAINT "SigningKey_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "EvidenceRun_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "EvidenceRun_submitterId_fkey" FOREIGN KEY ("submitterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_evidenceRunId_fkey" FOREIGN KEY ("evidenceRunId") REFERENCES "EvidenceRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Finding" ADD CONSTRAINT "Finding_exceptionRequestId_fkey" FOREIGN KEY ("exceptionRequestId") REFERENCES "ExceptionRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuotaCounter" ADD CONSTRAINT "QuotaCounter_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionProjection" ADD CONSTRAINT "SubscriptionProjection_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEventReceipt" ADD CONSTRAINT "PaymentEventReceipt_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrialFingerprint" ADD CONSTRAINT "TrialFingerprint_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditRecord" ADD CONSTRAINT "AuditRecord_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemOperatorGrant" ADD CONSTRAINT "SystemOperatorGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Cross-tenant composite foreign keys are the database authority. Prisma emits
-- scalar relations, so replace the affected constraints with workspace-aware
-- variants and make the bootstrap owner cycle transaction-deferrable.
ALTER TABLE "Workspace" DROP CONSTRAINT "Workspace_ownerMembershipId_fkey";
ALTER TABLE "Workspace" ADD CONSTRAINT "workspace_owner_membership_fkey"
  FOREIGN KEY ("id", "ownerMembershipId")
  REFERENCES "Membership"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Membership" DROP CONSTRAINT "Membership_roleProfileId_fkey";
ALTER TABLE "Membership" ADD CONSTRAINT "membership_workspace_role_fkey"
  FOREIGN KEY ("workspaceId", "roleProfileId")
  REFERENCES "RoleProfile"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invitation" DROP CONSTRAINT "Invitation_roleProfileId_fkey";
ALTER TABLE "Invitation" ADD CONSTRAINT "invitation_workspace_role_fkey"
  FOREIGN KEY ("workspaceId", "roleProfileId")
  REFERENCES "RoleProfile"("workspaceId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PolicyRevision" DROP CONSTRAINT "PolicyRevision_packId_fkey";
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_workspace_pack_fkey"
  FOREIGN KEY ("workspaceId", "packId")
  REFERENCES "PolicyPack"("workspaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "PolicyPack" DROP CONSTRAINT "PolicyPack_activeRevisionId_fkey";
ALTER TABLE "PolicyPack" ADD CONSTRAINT "policy_pack_active_revision_fkey"
  FOREIGN KEY ("id", "activeRevisionId")
  REFERENCES "PolicyRevision"("packId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE DEFERRABLE INITIALLY DEFERRED;

ALTER TABLE "Finding" DROP CONSTRAINT "Finding_evidenceRunId_fkey";
ALTER TABLE "Finding" ADD CONSTRAINT "finding_workspace_run_fkey"
  FOREIGN KEY ("workspaceId", "evidenceRunId")
  REFERENCES "EvidenceRun"("workspaceId", "id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Finding" DROP CONSTRAINT "Finding_exceptionRequestId_fkey";
ALTER TABLE "Finding" ADD CONSTRAINT "finding_workspace_exception_fkey"
  FOREIGN KEY ("workspaceId", "exceptionRequestId")
  REFERENCES "ExceptionRequest"("workspaceId", "id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_run_policy_digest_fkey"
  FOREIGN KEY ("workspaceId", "policyDigest")
  REFERENCES "PolicyRevision"("workspaceId", "digest")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Closed cardinality and active-row authorities.
CREATE UNIQUE INDEX "membership_one_owner_per_workspace_key"
  ON "Membership"("workspaceId") WHERE "isOwner" = true;
CREATE UNIQUE INDEX "invitation_one_active_email_key"
  ON "Invitation"("workspaceId", "normalizedEmail") WHERE "status" = 'active';
CREATE UNIQUE INDEX "policy_revision_one_active_per_pack_key"
  ON "PolicyRevision"("packId") WHERE "state" = 'active';

-- Bounded values and state invariants used by concurrent services.
ALTER TABLE "Workspace" ADD CONSTRAINT "workspace_name_length_check"
  CHECK (char_length(btrim("name")) BETWEEN 2 AND 120);
ALTER TABLE "Membership" ADD CONSTRAINT "membership_owner_role_shape_check"
  CHECK (("isOwner" AND "roleProfileId" IS NULL) OR (NOT "isOwner" AND "roleProfileId" IS NOT NULL));
ALTER TABLE "RoleProfile" ADD CONSTRAINT "role_profile_normalized_label_check"
  CHECK ("normalizedLabel" = lower(btrim("normalizedLabel")));
ALTER TABLE "RoleProfile" ADD CONSTRAINT "role_profile_reserved_label_check"
  CHECK ("builtIn" OR "normalizedLabel" NOT IN ('owner', 'administrator', 'policy_author', 'reviewer', 'observer'));
ALTER TABLE "Invitation" ADD CONSTRAINT "invitation_token_hash_check"
  CHECK ("tokenHash" ~ '^[0-9a-f]{64}$');
ALTER TABLE "QuotaCounter" ADD CONSTRAINT "quota_counter_nonnegative_check"
  CHECK ("used" >= 0 AND "reserved" >= 0);
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_run_nonnegative_counts_check"
  CHECK ("errorCount" >= 0 AND "warningCount" >= 0 AND "exceptedCount" >= 0 AND "filesScanned" >= 0 AND "durationMs" >= 0);
ALTER TABLE "Finding" ADD CONSTRAINT "finding_location_check"
  CHECK (
    "startLine" > 0 AND "startColumn" > 0 AND "endLine" > 0 AND "endColumn" > 0
    AND ("endLine" > "startLine" OR ("endLine" = "startLine" AND "endColumn" >= "startColumn"))
  );
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_maker_checker_check"
  CHECK ("approverId" IS NULL OR "approverId" <> "authorId");
ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_approval_shape_check"
  CHECK (
    ("state" = 'draft' AND "digest" IS NULL AND "approverId" IS NULL AND "approvedAt" IS NULL)
    OR ("state" <> 'draft' AND "digest" IS NOT NULL AND "approverId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  );
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_maker_checker_check"
  CHECK ("deciderId" IS NULL OR "deciderId" <> "requesterId");
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_decision_shape_check"
  CHECK (
    ("decisionState" = 'pending' AND "deciderId" IS NULL AND "decisionNote" IS NULL AND "decidedAt" IS NULL)
    OR ("decisionState" <> 'pending' AND "deciderId" IS NOT NULL AND char_length(btrim("decisionNote")) > 0 AND "decidedAt" IS NOT NULL)
  );
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_expiry_bound_check"
  CHECK ("validUntil" > "createdAt" AND "validUntil" <= "createdAt" + interval '90 days');
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_revocation_shape_check"
  CHECK (
    ("revokedAt" IS NULL AND "revokedById" IS NULL AND "revocationReason" IS NULL)
    OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND char_length(btrim("revocationReason")) > 0)
  );
CREATE FUNCTION kernel_zero_jsonb_key_count(value jsonb) RETURNS integer
  LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
  AS $$ SELECT count(*)::integer FROM jsonb_object_keys(value) $$;
ALTER TABLE "AuditRecord" ADD CONSTRAINT "audit_actor_shape_check"
  CHECK (
    ("actorKind" = 'user' AND "actorUserId" IS NOT NULL AND "systemActorRef" IS NULL)
    OR ("actorKind" = 'system' AND "actorUserId" IS NULL AND char_length(btrim("systemActorRef")) BETWEEN 1 AND 120)
  );
ALTER TABLE "AuditRecord" ADD CONSTRAINT "audit_metadata_bounds_check"
  CHECK (
    jsonb_typeof("metadata") = 'object'
    AND kernel_zero_jsonb_key_count("metadata") <= 32
    AND pg_column_size("metadata") <= 16384
  );
ALTER TABLE "PaymentEventReceipt" ADD CONSTRAINT "payment_receipt_retry_nonnegative_check"
  CHECK ("retryCount" >= 0);
ALTER TABLE "TrialFingerprint" ADD CONSTRAINT "trial_used_monotonic_shape_check"
  CHECK ("fingerprintHash" ~ '^sha256:[0-9a-f]{64}$');

ALTER TABLE "PolicyRevision" ADD CONSTRAINT "policy_revision_digest_check"
  CHECK ("digest" IS NULL OR "digest" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "ExceptionRequest" ADD CONSTRAINT "exception_digest_check"
  CHECK ("policyDigest" ~ '^sha256:[0-9a-f]{64}$' AND "findingFingerprint" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "EvidenceRun" ADD CONSTRAINT "evidence_digest_check"
  CHECK (
    "policyDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND "manifestDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND "integrityDigest" ~ '^sha256:[0-9a-f]{64}$'
    AND ("exceptionBundleDigest" IS NULL OR "exceptionBundleDigest" ~ '^sha256:[0-9a-f]{64}$')
  );
ALTER TABLE "Finding" ADD CONSTRAINT "finding_digest_check"
  CHECK ("findingId" ~ '^sha256:[0-9a-f]{64}$' AND "fingerprint" ~ '^sha256:[0-9a-f]{64}$');
ALTER TABLE "PaymentEventReceipt" ADD CONSTRAINT "payment_payload_digest_check"
  CHECK ("payloadDigest" ~ '^sha256:[0-9a-f]{64}$');

-- Approved policy bytes, audit receipts, and evidence rows are immutable. Policy
-- state may advance, but canonical bytes and approval provenance cannot change.
CREATE FUNCTION kernel_zero_reject_audit_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit records are immutable' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "audit_record_immutable_update"
  BEFORE UPDATE OR DELETE ON "AuditRecord"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_audit_change();

CREATE FUNCTION kernel_zero_guard_policy_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."state" <> 'draft' AND (
    NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId"
    OR NEW."packId" IS DISTINCT FROM OLD."packId"
    OR NEW."revision" IS DISTINCT FROM OLD."revision"
    OR NEW."authorId" IS DISTINCT FROM OLD."authorId"
    OR NEW."canonicalJson" IS DISTINCT FROM OLD."canonicalJson"
    OR NEW."digest" IS DISTINCT FROM OLD."digest"
    OR NEW."approverId" IS DISTINCT FROM OLD."approverId"
    OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
  ) THEN
    RAISE EXCEPTION 'approved policy revision content is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "policy_revision_immutable_content"
  BEFORE UPDATE ON "PolicyRevision"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_guard_policy_revision();

CREATE FUNCTION kernel_zero_reject_evidence_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'evidence rows cannot be edited' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER "evidence_run_immutable_update"
  BEFORE UPDATE ON "EvidenceRun"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_evidence_update();
CREATE TRIGGER "finding_immutable_update"
  BEFORE UPDATE ON "Finding"
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_reject_evidence_update();

-- Validate that the referenced owner membership is the workspace's unique owner
-- at transaction commit, after the cyclic bootstrap inserts have both occurred.
CREATE FUNCTION kernel_zero_validate_workspace_owner() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE valid_owner boolean;
BEGIN
  SELECT m."isOwner" INTO valid_owner
  FROM "Membership" m
  WHERE m."workspaceId" = NEW."id" AND m."id" = NEW."ownerMembershipId";
  IF valid_owner IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'workspace owner reference must target its owner membership' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER "workspace_owner_reference_check"
  AFTER INSERT OR UPDATE OF "ownerMembershipId" ON "Workspace"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION kernel_zero_validate_workspace_owner();
