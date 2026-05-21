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
  if (signingPlan.codeSigningEnabled) {
    if (signingPlan.identityName) {
      console.log(
        `macOS code signing enabled with CSC_NAME identity "${signingPlan.identityName}".`,
      );
    } else {
      console.log(
        "macOS code signing enabled; electron-builder will derive the identity from CSC_LINK.",
      );
    }
  } else {
    logWarning(
      "macOS signing/notarization skipped: no required signing secrets found. Local artifacts will be unsigned.",
    );
  }

  if (signingPlan.notarizationEnabled) {
    console.log("macOS notarization enabled.");
  }
}

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
      )}. Set all required keys or unset all of them for an unsigned local build.`,
    );
  }

  const codeSigningEnabled = hasAllSigningKeys;
  const identityName = envValueIsSet(env.CSC_NAME)
    ? env.CSC_NAME.trim()
    : undefined;

  return {
    codeSigningEnabled,
    identityName,
    notarizationEnabled: codeSigningEnabled,
  };
}

export function resolveElectronBuilderConfig(baseConfig, env) {
  const signingPlan = createSigningPlan(env);
  const config = cloneJson(baseConfig);
  const mac = {
    ...config.mac,
    notarize: signingPlan.notarizationEnabled,
  };

  if (signingPlan.codeSigningEnabled) {
    if (signingPlan.identityName) {
      mac.identity = signingPlan.identityName;
    } else {
      delete mac.identity;
    }
  } else {
    mac.identity = null;
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
    signingPlan.codeSigningEnabled && !signingPlan.identityName
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
