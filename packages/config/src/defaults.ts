export const DEFAULTS = {
  appVersion: "0.0.0-dev",
  logLevel: { prod: "info", dev: "debug" },
  secretToken: { dev: "dev-secret" },
} as const;
