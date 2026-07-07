import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import {
  account,
  isGithubUserAllowed,
  parseAllowedGithubUsers,
  session,
  user,
  verification,
} from "@bb/connect-db";
import type { Env } from "./env.js";

export type Auth = ReturnType<typeof createAuth>;

/**
 * better-auth bound to the staging D1 via drizzle. GitHub is the only provider.
 * Cookies are scoped to `.${BASE_DOMAIN}` so the tunnel gate on
 * `<handle>.${BASE_DOMAIN}` can validate the same session.
 *
 * While bb connect is invite-only, sign-in is gated on the
 * CONNECT_ALLOWED_GITHUB_USERS allowlist: the GitHub `login` is stored on the
 * user (refreshed every sign-in via overrideUserInfoOnSignIn) and checked both
 * at user creation (signup) and session creation (every subsequent sign-in),
 * so removing a username from the var locks the account out at next login.
 */
export function createAuth(env: Env) {
  const db = drizzle(env.DB);
  const allowedGithubUsers = parseAllowedGithubUsers(
    env.CONNECT_ALLOWED_GITHUB_USERS,
  );
  const requireAllowedGithubLogin = (login: string | null | undefined) => {
    if (!isGithubUserAllowed(allowedGithubUsers, login)) {
      throw new APIError("FORBIDDEN", {
        message: "bb connect is invite-only right now.",
      });
    }
  };
  return betterAuth({
    appName: "bb connect",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL, `https://*.${env.BASE_DOMAIN}`],
    // `better-auth` and `@better-auth/drizzle-adapter` resolve to two copies of
    // `@better-auth/core` under pnpm (different peer hashes — workers-types is in
    // one peer set), so the adapter's type is nominally distinct though identical
    // at runtime. Cast across that boundary to the option's own database type.
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }) as unknown as Parameters<typeof betterAuth>[0]["database"],
    emailAndPassword: { enabled: false },
    user: {
      additionalFields: {
        githubLogin: { type: "string", required: false, input: false },
      },
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
        overrideUserInfoOnSignIn: true,
        mapProfileToUser: (profile) => ({ githubLogin: profile.login }),
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (userData) => {
            requireAllowedGithubLogin(
              (userData as { githubLogin?: string | null }).githubLogin,
            );
          },
        },
      },
      session: {
        create: {
          before: async (sessionData) => {
            const row = await db
              .select({ githubLogin: user.githubLogin })
              .from(user)
              .where(eq(user.id, sessionData.userId))
              .get();
            requireAllowedGithubLogin(row?.githubLogin);
          },
        },
      },
    },
    advanced: {
      crossSubDomainCookies: { enabled: true, domain: `.${env.BASE_DOMAIN}` },
    },
  });
}
