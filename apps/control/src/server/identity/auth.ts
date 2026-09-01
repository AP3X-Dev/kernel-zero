import "server-only";

import type { PersistenceClient } from "@kernel-zero/persistence";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";

import type { KernelZeroConfig } from "../config/config";
import type { IdentityEmailSender } from "./email";

export function createAuth(
  prisma: PersistenceClient,
  config: KernelZeroConfig,
  emailSender: IdentityEmailSender,
) {
  return betterAuth({
    advanced: {
      cookiePrefix: "kernel-zero",
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: config.environment === "production",
      },
      disableCSRFCheck: false,
      disableOriginCheck: false,
      useSecureCookies: config.environment === "production",
    },
    appName: "KERNEL ZERO",
    baseURL: config.appUrl.origin,
    database: prismaAdapter(prisma, { provider: "postgresql", transaction: true }),
    databaseHooks: {
      user: {
        create: {
          before(user) {
            if (!config.registrationOpen) return Promise.resolve(false);
            const normalizedEmail = user.email.trim().toLowerCase();
            return Promise.resolve({ data: { ...user, normalizedEmail } });
          },
        },
      },
    },
    emailAndPassword: {
      disableSignUp: !config.registrationOpen,
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      async sendResetPassword({ user, url }) {
        await emailSender.send({ actionUrl: url, kind: "password-reset", recipient: user.email });
      },
    },
    emailVerification: {
      autoSignInAfterVerification: false,
      sendOnSignUp: true,
      async sendVerificationEmail({ user, url }) {
        await emailSender.send({ actionUrl: url, kind: "verification", recipient: user.email });
      },
    },
    secret: config.identitySecret,
    socialProviders: config.google.enabled
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    trustedOrigins: [config.appUrl.origin],
    user: {
      fields: { image: "imageUrl", name: "displayName" },
    },
  });
}

export type KernelZeroAuth = ReturnType<typeof createAuth>;
