import { env as workerEnv } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  TUNNEL_DO: DurableObjectNamespace;
  BASE_DOMAIN: string;
  APP_URL: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  /**
   * Comma-separated GitHub usernames allowed to sign in while bb connect is
   * invite-only. Unset or empty means nobody can sign in (fail closed).
   */
  CONNECT_ALLOWED_GITHUB_USERS?: string;
  /**
   * Marketing-page endpoints (see src/landing/endpoints.ts). Unset on forks
   * and local dev: /api/subscribe reports signup as not configured, and the
   * download redirect skips server-side click tracking.
   */
  LANDING_POSTHOG_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
}

export function getEnv(): Env {
  return workerEnv as unknown as Env;
}
