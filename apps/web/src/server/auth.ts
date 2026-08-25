import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import {
  account,
  CONNECT_SESSION_EXPIRES_IN_SECONDS,
  CONNECT_SESSION_UPDATE_AGE_SECONDS,
  session,
  user,
  verification,
} from "@bb/connect-db";
import type { Env } from "./env.js";
import { resolveDevEmailPasswordEnabled } from "./local-auth.js";

export type Auth = ReturnType<typeof createAuth>;

/**
 * better-auth bound to the Cloud D1 via drizzle. Production uses GitHub;
 * local Cloud additionally enables email/password credentials.
 * Cookies are scoped to `.${BASE_DOMAIN}` so the tunnel gate on
 * `<handle>.${BASE_DOMAIN}` can validate the same session.
 */
export function createAuth(env: Env) {
  const db = drizzle(env.DB);
  const appUrl = new URL(env.APP_URL);
  const devEmailPasswordEnabled = resolveDevEmailPasswordEnabled(env);
  const subdomainOrigin = `${appUrl.protocol}//*.${env.BASE_DOMAIN}${
    appUrl.port ? `:${appUrl.port}` : ""
  }`;
  return betterAuth({
    appName: "bb connect",
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.APP_URL,
    trustedOrigins: [env.APP_URL, subdomainOrigin],
    // `better-auth` and `@better-auth/drizzle-adapter` resolve to two copies of
    // `@better-auth/core` under pnpm (different peer hashes — workers-types is in
    // one peer set), so the adapter's type is nominally distinct though identical
    // at runtime. Cast across that boundary to the option's own database type.
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }) as unknown as Parameters<typeof betterAuth>[0]["database"],
    session: {
      expiresIn: CONNECT_SESSION_EXPIRES_IN_SECONDS,
      updateAge: CONNECT_SESSION_UPDATE_AGE_SECONDS,
    },
    emailAndPassword: { enabled: devEmailPasswordEnabled },
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
    advanced: {
      crossSubDomainCookies: { enabled: true, domain: `.${env.BASE_DOMAIN}` },
    },
  });
}
