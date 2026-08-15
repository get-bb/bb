export interface ElectronBuilderSigningPlan {
  identityName: string | undefined;
  mode: "disabled" | "environment" | "keychain";
  notarizationEnabled: boolean;
}

export interface ElectronBuilderSigningEnvironment {
  codeSigningKeys: readonly string[];
  macCodeSigningSecretKeys: readonly string[];
  missingEnvironmentKeys: (
    keys: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => string[];
  notarizationKeys: readonly string[];
  requiredSigningEnvironmentKeys: readonly string[];
}

export function shouldStripMacCodeSigningSecrets(
  electronBuilderArgs: readonly string[],
): boolean;

export function createElectronBuilderEnv(
  signingPlan: ElectronBuilderSigningPlan,
  env?: NodeJS.ProcessEnv,
  electronBuilderArgs?: readonly string[],
): NodeJS.ProcessEnv;

export function resolveElectronBuilderConfig(
  baseConfig: unknown,
  env: NodeJS.ProcessEnv,
): {
  config: unknown;
  releaseChannel: "latest" | "nightly";
  signingPlan: ElectronBuilderSigningPlan;
};

export const electronBuilderSigningEnvironment: ElectronBuilderSigningEnvironment;
