import { buildShellEnvOverrides } from "./adapter-utils.js";
import { PROVIDER_BRIDGE_RECORD_DIR_ENV } from "./bridge-recorder.js";

export function withoutBridgeRuntimeEnv(
  env: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const childEnv: NodeJS.ProcessEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  delete childEnv[PROVIDER_BRIDGE_RECORD_DIR_ENV];
  return childEnv;
}

export function buildProviderCliEnv(
  envVars: Readonly<Record<string, string>> | undefined,
): NodeJS.ProcessEnv {
  const inherited = withoutBridgeRuntimeEnv(process.env);
  const overrides = buildShellEnvOverrides(envVars);
  if (process.platform === "win32") {
    const overridden = new Set(
      Object.keys(overrides).map((name) => name.toUpperCase()),
    );
    for (const name of Object.keys(inherited)) {
      if (overridden.has(name.toUpperCase())) delete inherited[name];
    }
  }
  return { ...inherited, ...overrides };
}
