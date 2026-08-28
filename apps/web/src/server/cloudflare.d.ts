declare module "cloudflare:workers" {
  export const env: import("./env.js").Env;
  export function waitUntil(promise: Promise<void>): void;
}
