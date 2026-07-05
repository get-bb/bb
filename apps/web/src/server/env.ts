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
}

export function getEnv(): Env {
  return workerEnv as unknown as Env;
}
