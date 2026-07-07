// Ambient type for the Workers runtime module exposed by @cloudflare/vite-plugin.
// Concrete binding shape is declared in Env (env.ts).
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  export function waitUntil(promise: Promise<unknown>): void;
}
