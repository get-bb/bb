import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const desktopPackageRoot = resolve(scriptDirectory, "..");
const baseConfigPath = resolve(
  desktopPackageRoot,
  "electron-builder.config.json",
);
const generatedConfigPath = resolve(
  desktopPackageRoot,
  ".electron-builder.generated.json",
);
const electronBuilderBin = resolve(
  desktopPackageRoot,
  "node_modules",
  ".bin",
  "electron-builder",
);

const codeSigningKeys = ["CSC_LINK", "CSC_KEY_PASSWORD"];
const notarizationKeys = [
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];
const requiredSigningEnvironmentKeys = [
  ...codeSigningKeys,
  ...notarizationKeys,
];

const printConfigFlag = "--print-config";

function envValueIsSet(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function missingEnvironmentKeys(keys, env) {
  return keys.filter((key) => !envValueIsSet(env[key]));
}

function presentEnvironmentKeys(keys, env) {
  return keys.filter((key) => envValueIsSet(env[key]));
}

function formatEnvironmentKeyList(keys) {
  if (keys.length === 0) {
    return "none";
  }

  return keys.join(", ");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function logWarning(message) {
  if (process.env.GITHUB_ACTIONS === "true") {
    console.warn(`::warning::${message}`);
    return;
  }

  console.warn(message);
}

function logSigningPlan(signingPlan) {
  if (signingPlan.mode === "environment") {
    if (signingPlan.identityName) {
      console.log(
        `macOS code signing enabled with CSC_NAME identity "${signingPlan.identityName}".`,
      );
    } else {
      console.log(
        "macOS code signing enabled; electron-builder will derive the identity from CSC_LINK.",
      );
    }
  } else if (signingPlan.mode === "keychain") {
    console.log(
      "macOS code signing via keychain auto-discovery; artifacts stay unsigned if no identity is installed. Notarization skipped.",
    );
  } else {
    logWarning(
      "macOS signing skipped: CSC_IDENTITY_AUTO_DISCOVERY=false and no signing secrets found. Artifacts will be unsigned.",
    );
  }

  if (signingPlan.notarizationEnabled) {
    console.log("macOS notarization enabled.");
  }
}

function autoDiscoveryExplicitlyDisabled(env) {
  return (
    envValueIsSet(env.CSC_IDENTITY_AUTO_DISCOVERY) &&
    env.CSC_IDENTITY_AUTO_DISCOVERY.trim() === "false"
  );
}

/**
 * Resolves one of three signing modes:
 *
 * - "environment": all CI signing/notarization secrets are set — sign with the
 *   provided certificate and notarize (the published-release path).
 * - "keychain": no secrets — sign with an auto-discovered keychain identity and
 *   skip notarization. Locally built apps never get the quarantine xattr, so
 *   notarization is unnecessary, but a valid signature is not optional: an
 *   unsigned bundle is provenance-tracked by macOS, which forces syspolicyd to
 *   evaluate every exec in the app's process tree and can stall execs
 *   system-wide. Machines without a signing identity fall back to unsigned
 *   artifacts inside electron-builder.
 * - "disabled": no secrets and CSC_IDENTITY_AUTO_DISCOVERY=false — explicitly
 *   unsigned (the CI path for workflow-artifact-only builds).
 */
function createSigningPlan(env) {
  const presentSigningKeys = presentEnvironmentKeys(
    requiredSigningEnvironmentKeys,
    env,
  );
  const missingSigningKeys = missingEnvironmentKeys(
    requiredSigningEnvironmentKeys,
    env,
  );
  const hasAnySigningKeys = presentSigningKeys.length > 0;
  const hasAllSigningKeys = missingSigningKeys.length === 0;

  if (hasAnySigningKeys && !hasAllSigningKeys) {
    throw new Error(
      `Incomplete macOS signing/notarization environment. Present: ${formatEnvironmentKeyList(
        presentSigningKeys,
      )}. Missing: ${formatEnvironmentKeyList(
        missingSigningKeys,
      )}. Set all required keys or unset all of them for a keychain-signed local build.`,
    );
  }

  if (hasAllSigningKeys) {
    return {
      mode: "environment",
      identityName: envValueIsSet(env.CSC_NAME)
        ? env.CSC_NAME.trim()
        : undefined,
      notarizationEnabled: true,
    };
  }

  return {
    mode: autoDiscoveryExplicitlyDisabled(env) ? "disabled" : "keychain",
    identityName: undefined,
    notarizationEnabled: false,
  };
}

export function resolveElectronBuilderConfig(baseConfig, env) {
  const signingPlan = createSigningPlan(env);
  const config = cloneJson(baseConfig);
  const mac = {
    ...config.mac,
    notarize: signingPlan.notarizationEnabled,
  };

  if (signingPlan.mode === "disabled") {
    mac.identity = null;
  } else if (signingPlan.identityName) {
    mac.identity = signingPlan.identityName;
  } else {
    // Let electron-builder resolve the identity (CSC_LINK or keychain).
    delete mac.identity;
  }

  config.mac = mac;

  return {
    config,
    signingPlan,
  };
}

function createElectronBuilderEnv(signingPlan) {
  const childEnv = {
    ...process.env,
  };

  childEnv.CSC_IDENTITY_AUTO_DISCOVERY =
    signingPlan.mode !== "disabled" && !signingPlan.identityName
      ? "true"
      : "false";

  return childEnv;
}

async function readBaseConfig() {
  const configText = await readFile(baseConfigPath, "utf8");
  return JSON.parse(configText);
}

async function writeGeneratedConfig(config) {
  await writeFile(generatedConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

async function removeGeneratedConfig() {
  await rm(generatedConfigPath, { force: true });
}

async function runElectronBuilder(args, signingPlan) {
  const child = spawn(
    electronBuilderBin,
    ["--config", generatedConfigPath, ...args],
    {
      cwd: desktopPackageRoot,
      env: createElectronBuilderEnv(signingPlan),
      stdio: "inherit",
    },
  );

  const exitCode = await new Promise((resolveExitCode) => {
    child.on("error", () => {
      resolveExitCode(1);
    });
    child.on("close", resolveExitCode);
  });

  if (typeof exitCode === "number") {
    process.exitCode = exitCode;
    return;
  }

  process.exitCode = 1;
}

async function main() {
  const args = process.argv.slice(2);
  const printConfig = args.includes(printConfigFlag);
  const electronBuilderArgs = args.filter((arg) => arg !== printConfigFlag);
  const baseConfig = await readBaseConfig();
  const { config, signingPlan } = resolveElectronBuilderConfig(
    baseConfig,
    process.env,
  );

  if (printConfig) {
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  logSigningPlan(signingPlan);
  await mkdir(dirname(generatedConfigPath), { recursive: true });
  await writeGeneratedConfig(config);
  try {
    await runElectronBuilder(electronBuilderArgs, signingPlan);
  } finally {
    await removeGeneratedConfig();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main().catch((error) => {
    if (error instanceof Error) {
      console.error(error.message);
    } else {
      console.error(String(error));
    }

    process.exitCode = 1;
  });
}

export const electronBuilderSigningEnvironment = {
  codeSigningKeys,
  missingEnvironmentKeys,
  notarizationKeys,
  requiredSigningEnvironmentKeys,
};
