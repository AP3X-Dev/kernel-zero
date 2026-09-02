import "server-only";

import { generateUuidV7 } from "@kernel-zero/domain";
import type { PersistenceClient } from "@kernel-zero/persistence";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

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
      // Every identity table keys on a UUID column, so the default random string identifier would be rejected on write.
      database: { generateId: () => generateUuidV7() },
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
    // Server actions call the auth API directly, so session cookies must be written through the framework's store.
    plugins: [nextCookies()],
    secret: config.identitySecret,
    socialProviders: config.google.enabled
      ? { google: { clientId: config.google.clientId, clientSecret: config.google.clientSecret } }
      : {},
    trustedOrigins: [config.appUrl.origin],
    user: {
      // The create hook derives the unique normalized email; declaring it lets that value reach the database.
      // `input: false` keeps a client from forging it, and `required: false` keeps the sign-up body from demanding
      // a field only the hook may set. The column itself is NOT NULL, so presence stays enforced where it counts.
      additionalFields: { normalizedEmail: { input: false, required: false, type: "string" } },
      fields: { image: "imageUrl", name: "displayName" },
    },
  });
}

export type KernelZeroAuth = ReturnType<typeof createAuth>;
