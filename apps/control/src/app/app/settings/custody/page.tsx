import { canonicalJson, resolveCorrelationId } from "@kernel-zero/domain";
import { redirect } from "next/navigation";
import { z } from "zod";

import { loadPolicyCustodyView } from "../../../../server/application/governance-view";
import { requireCapability } from "../../../../server/authorization/workspace";
import { PolicyCustodyService } from "../../../../server/policy/custody-service";
import { FormSubmit } from "../../form-submit";
import { MUTATION_STATE_MESSAGES, type MutationState } from "../../navigation";
import { requireWorkspaceRoute } from "../../route-context";
import { EmptyState, PageHeading, Status } from "../../ui-components";

export const dynamic = "force-dynamic";

const ROUTE = "/app/settings/custody";
const KeyIdSchema = z.string().trim().min(1).max(120);
const RegisterSchema = z.strictObject({
  keyId: KeyIdSchema,
  label: z.string().trim().min(1).max(120),
  publicKeyX: z.string().trim().regex(/^[A-Za-z0-9_-]{43}$/u),
  validUntil: z.iso.date().nullable(),
});
const RevokeSchema = z.strictObject({ confirmKeyId: KeyIdSchema, keyId: KeyIdSchema }).refine((value) => value.keyId === value.confirmKeyId);

type CustodyPageProps = Readonly<{ searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>> }>;

async function sessionContext() {
  return requireWorkspaceRoute("policy.read", ROUTE);
}

function field(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0 ? value : null;
}

function noticeFor(error: unknown): MutationState {
  const message = error instanceof Error ? error.message : "";
  if (message.startsWith("FORBIDDEN")) return "authorization";
  if (message.startsWith("VALIDATION_FAILED") || message.startsWith("CONFLICT")) return "validation";
  return "retryable-error";
}

async function registerKeyAction(formData: FormData): Promise<void> {
  "use server";
  const { context, runtime, session } = await sessionContext();
  const parsed = RegisterSchema.safeParse({
    keyId: field(formData, "keyId"), label: field(formData, "label"), publicKeyX: field(formData, "publicKeyX"), validUntil: field(formData, "validUntil"),
  });
  if (!parsed.success) redirect(`${ROUTE}?notice=validation`);
  let notice: MutationState = "success";
  try {
    await new PolicyCustodyService(runtime.prisma).registerKey({
      actor: { capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null, isOwner: context.membership.isOwner, userId: session.user.id },
      correlationId: resolveCorrelationId(undefined).id,
      keyId: parsed.data.keyId, label: parsed.data.label, publicKeyX: parsed.data.publicKeyX,
      validFrom: new Date(), validUntil: parsed.data.validUntil === null ? null : new Date(`${parsed.data.validUntil}T23:59:59.999Z`),
      workspaceId: context.workspace.id,
    });
  } catch (error: unknown) {
    notice = noticeFor(error);
  }
  redirect(`${ROUTE}?notice=${notice}`);
}

async function revokeKeyAction(formData: FormData): Promise<void> {
  "use server";
  const { context, runtime, session } = await sessionContext();
  const parsed = RevokeSchema.safeParse({ confirmKeyId: field(formData, "confirmKeyId"), keyId: field(formData, "keyId") });
  if (!parsed.success) redirect(`${ROUTE}?notice=validation`);
  let notice: MutationState = "success";
  try {
    const result = await new PolicyCustodyService(runtime.prisma).revokeKey({
      actor: { capabilityDocument: context.membership.roleProfile?.capabilityDocument ?? null, isOwner: context.membership.isOwner, userId: session.user.id },
      correlationId: resolveCorrelationId(undefined).id, keyId: parsed.data.keyId, revokedFrom: new Date(), workspaceId: context.workspace.id,
    });
    if (!result.revoked) notice = "empty";
  } catch (error: unknown) {
    notice = noticeFor(error);
  }
  redirect(`${ROUTE}?notice=${notice}`);
}

function isMutationState(value: string | undefined): value is MutationState {
  return value !== undefined && value in MUTATION_STATE_MESSAGES;
}

export default async function PolicyCustodyPage({ searchParams }: CustodyPageProps) {
  const { authority, context, runtime } = await sessionContext();
  const query = await searchParams;
  const notice = typeof query.notice === "string" && isMutationState(query.notice) ? MUTATION_STATE_MESSAGES[query.notice] : null;
  const view = await loadPolicyCustodyView(runtime.prisma, context.workspace.id);
  const canManage = requireCapability(authority, "policy.authority-key.manage") === null;
  const now = Date.now();
  return (
    <main className="app-main" id="main-content">
      <PageHeading description="Authority keys decide which approved policy the validator trusts. Only public key material is stored here; signing happens only inside approval with custody.">Policy custody</PageHeading>
      {notice === null ? null : <p role="status">{notice}</p>}
      {view.keys.length === 0 ? (
        <EmptyState title="No policy authority keys">Register the public coordinate of a workspace authority key to start producing signed approvals and a trust bundle.</EmptyState>
      ) : (
        <ul aria-label="Policy authority keys" className="row-list">
          {view.keys.map((key) => {
            const revokedFrom = key.revokedFrom !== null && key.revokedFrom.getTime() <= now ? key.revokedFrom.toISOString() : null;
            const expired = key.validUntil !== null && key.validUntil.getTime() < now;
            return (
              <li className="row-card" key={key.id}>
                <dl><dt>Key</dt><dd>{key.keyId}<br /><span className="muted">{key.label}</span></dd></dl>
                <dl><dt>Valid</dt><dd>from {key.validFrom.toISOString()}<br /><span className="muted">{key.validUntil === null ? "no expiry" : `until ${key.validUntil.toISOString()}`}</span></dd></dl>
                <dl><dt>Status</dt><dd>
                  {revokedFrom !== null
                    ? <Status tone="danger">revoked from {revokedFrom}</Status>
                    : expired ? <Status tone="warning">expired</Status> : <Status tone="positive">active</Status>}
                </dd></dl>
              </li>
            );
          })}
        </ul>
      )}
      <section className="panel">
        <h2>Workspace trust bundle</h2>
        {view.bundle === null ? <p className="muted">The bundle exists once at least one authority key is registered.</p> : (
          <>
            <dl>
              <dt>Revision</dt><dd>{view.bundle.revision}</dd>
              <dt>Integrity</dt><dd>{view.bundle.integrity.digest}</dd>
            </dl>
            <p>Hand this file to CI as <code>--workspace-trust</code>. Protect it like the policy: the validator never fetches trust on its own. Re-export after every registration or revocation.</p>
            <label htmlFor="trust-bundle">Trust bundle JSON</label>
            <textarea id="trust-bundle" readOnly rows={8} value={canonicalJson(view.bundle)} />
          </>
        )}
      </section>
      {canManage ? (
        <>
          <form action={registerKeyAction} className="panel">
            <h2>Register an authority key</h2>
            <label htmlFor="custody-key-id">Key ID</label>
            <input id="custody-key-id" maxLength={120} name="keyId" required type="text" />
            <label htmlFor="custody-label">Label</label>
            <input id="custody-label" maxLength={120} name="label" required type="text" />
            <label htmlFor="custody-public-x">Ed25519 public coordinate (JWK x, 43 base64url characters)</label>
            <input autoComplete="off" id="custody-public-x" maxLength={43} minLength={43} name="publicKeyX" pattern="[A-Za-z0-9_-]{43}" required spellCheck={false} type="text" />
            <label htmlFor="custody-valid-until">Valid until (optional, UTC date)</label>
            <input id="custody-valid-until" name="validUntil" type="date" />
            <p className="muted">Validity starts now. Never paste private key material; only the public coordinate is accepted.</p>
            <FormSubmit pendingLabel="Registering…">Register key</FormSubmit>
          </form>
          <form action={revokeKeyAction} className="panel">
            <h2>Revoke an authority key</h2>
            <p>Revocation is retroactive from now: approvals signed with this key at or after this instant stop verifying. Type the key ID twice to confirm.</p>
            <label htmlFor="custody-revoke-id">Key ID</label>
            <input id="custody-revoke-id" maxLength={120} name="keyId" required type="text" />
            <label htmlFor="custody-revoke-confirm">Confirm key ID</label>
            <input id="custody-revoke-confirm" maxLength={120} name="confirmKeyId" required type="text" />
            <FormSubmit pendingLabel="Revoking…">Revoke key</FormSubmit>
          </form>
        </>
      ) : null}
    </main>
  );
}
