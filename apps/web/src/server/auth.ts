import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { drizzle } from "drizzle-orm/d1";
import { account, session, user, verification } from "@bb/connect-db";
import type { Env } from "./env.js";

export type Auth = ReturnType<typeof createAuth>;

/**
 * better-auth bound to the staging D1 via drizzle. GitHub is the only provider.
 * Cookies are scoped to `.${BASE_DOMAIN}` so the tunnel gate on
 * `<handle>.${BASE_DOMAIN}` can validate the same session.
 */
export function createAuth(env: Env) {
  const db = drizzle(env.DB);
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
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    advanced: {
      crossSubDomainCookies: { enabled: true, domain: `.${env.BASE_DOMAIN}` },
    },
  });
}
