import {
  readOptionalEnvVar,
  readRequiredEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import { BB_SERVER_URL_ENV } from "./env-vars.js";
import { validateRequiredUrl } from "./public-url.js";
import { resolveDevInstanceConfig } from "./runtime.js";

interface LoadServerUrlValueArgs extends EnvLoaderArgs {
  repoRoot?: string;
  serverUrl?: string;
}

export function loadServerUrlValue(args: LoadServerUrlValueArgs = {}): string {
  if (args.serverUrl !== undefined) {
    return validateRequiredUrl(BB_SERVER_URL_ENV.name, args.serverUrl);
  }

  const loader = resolveEnvLoader(args);
  const configuredServerUrl = readOptionalEnvVar({
    context: loader.context,
    definition: BB_SERVER_URL_ENV,
    env: loader.env,
  });
  if (configuredServerUrl !== undefined) {
    return configuredServerUrl;
  }

  if (loader.mode === "dev" && args.repoRoot !== undefined) {
    return resolveDevInstanceConfig({
      homeDir: loader.context.homeDir,
      repoRoot: args.repoRoot,
    }).serverUrl;
  }

  return readRequiredEnvVar({
    context: loader.context,
    definition: BB_SERVER_URL_ENV,
    env: loader.env,
  });
}
