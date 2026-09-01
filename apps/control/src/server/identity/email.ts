import "server-only";

import { Resend } from "resend";

import type { KernelZeroConfig } from "../config/config";
import type { DevelopmentAction, DevelopmentOutbox } from "../email/outbox";

export type IdentityEmail = Readonly<{
  actionUrl: string;
  kind: "invitation" | "password-reset" | "verification";
  recipient: string;
}>;

export type IdentityEmailSender = Readonly<{
  send(action: IdentityEmail): Promise<void>;
}>;

export function createIdentityEmailSender(
  config: KernelZeroConfig,
  developmentOutbox: DevelopmentOutbox,
): IdentityEmailSender {
  if (config.email.kind === "local-outbox") {
    return {
      send(action) {
        const item: DevelopmentAction = { ...action, createdAt: new Date() };
        const result = developmentOutbox.enqueue(item);
        return result.ok
          ? Promise.resolve()
          : Promise.reject(new Error(result.error.code));
      },
    };
  }

  const emailConfig = config.email;
  const resend = new Resend(emailConfig.apiKey);
  return {
    async send(action) {
      const subject = action.kind === "verification"
        ? "Verify your KERNEL ZERO email"
        : action.kind === "invitation"
          ? "Join a KERNEL ZERO workspace"
          : "Reset your KERNEL ZERO password";
      const response = await resend.emails.send({
        from: emailConfig.from,
        subject,
        text: `${subject}: ${action.actionUrl}`,
        to: action.recipient,
      });
      if (response.error !== null) throw new Error("EMAIL_DELIVERY_FAILED");
    },
  };
}
