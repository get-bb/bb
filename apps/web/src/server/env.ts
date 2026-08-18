import { env as workerEnv } from "cloudflare:workers";

export interface Env {
  DB: D1Database;
  TUNNEL_DO: DurableObjectNamespace;
  BASE_DOMAIN: string;
  APP_URL: string;
  CONNECT_SERVER_URL_TEMPLATE?: string;
  DEV_EMAIL_PASSWORD_AUTH?: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_SECRET: string;
  /**
   * Marketing-page endpoints (see src/landing/endpoints.ts). Unset on forks
   * and local dev: /api/subscribe reports signup as not configured, and the
   * download redirect skips server-side click tracking.
   */
  LANDING_POSTHOG_KEY?: string;
  RESEND_API_KEY?: string;
  RESEND_AUDIENCE_ID?: string;
  /**
   * bb-marketplace R2 bucket holding the bb-community plugin catalog. Optional:
   * the bucket is provisioned outside this deploy, and /marketplace/v1/*
   * answers 404 until it exists.
   */
  MARKETPLACE?: R2Bucket;
}

export function getEnv(): Env {
  return workerEnv as unknown as Env;
}
