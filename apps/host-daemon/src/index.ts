import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHostDaemonStartConfig } from "@bb/config/host-daemon";
import { loadHostDaemonEntrypointConfig } from "@bb/config/host-daemon-entrypoint";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@bb/process-utils";

interface ReportStartupFailureArgs {
  diagnosticsLogsDir: string;
  error: unknown;
}

type MainFailureHandler = (error: unknown) => void;

const entrypointDir = dirname(fileURLToPath(import.meta.url));

/**
 * In a packaged build the daemon bundle sits beside the bundled bridge files,
 * so their directory is the entrypoint directory; running from source it is
 * not, and the bundled bridges resolve from their TypeScript sources instead.
 *
 * The sentinel is the Pi bridge because Pi's bridge is the one that stays
 * daemon-bundled: its agent tree cannot be inlined into a relocatable
 * artifact (empirically verified — see the graduation plan), while every other
 * first-party bridge ships as a plugin artifact.
 */
function resolveEntrypointBridgeBundleDir(): string | undefined {
  return existsSync(join(entrypointDir, "bb-pi-bridge.mjs"))
    ? entrypointDir
    : undefined;
}

function resolveDiagnosticsLogsDir(): string {
  const hostDaemonStartConfig = loadHostDaemonStartConfig({
    enableLocalApi: true,
  });

  if (hostDaemonStartConfig.dataDir === undefined) {
    throw new Error("Host daemon data directory is required");
  }

  return join(hostDaemonStartConfig.dataDir, "logs");
}

function reportStartupFailure(args: ReportStartupFailureArgs): void {
  try {
    writeSafeProcessDiagnosticReport({
      kind: "startupFailure",
      logsDir: args.diagnosticsLogsDir,
      processName: "host-daemon",
      error: args.error,
    });
  } catch {
    // Keep the original startup failure visible even if diagnostic logging fails.
  }

  const message =
    args.error instanceof Error
      ? (args.error.stack ?? args.error.message)
      : String(args.error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function runHostDaemonEntrypoint(): Promise<void> {
  const hostDaemonEntrypointConfig = loadHostDaemonEntrypointConfig();
  // Keep this import after diagnostics so ESM evaluation failures are reported.
  const hostDaemonModule = await import("./start-host-daemon.js");
  const daemon = await hostDaemonModule.startHostDaemon({
    bbExecutableDirectory: hostDaemonEntrypointConfig.BB_CLI_DIR,
    bridgeBundleDir:
      hostDaemonEntrypointConfig.BB_BRIDGE_DIR ??
      resolveEntrypointBridgeBundleDir(),
    machineCredential: hostDaemonEntrypointConfig.BB_CONNECT_MACHINE_CREDENTIAL,
    connectMachineId: hostDaemonEntrypointConfig.BB_CONNECT_MACHINE_ID,
    autoUpdate: hostDaemonEntrypointConfig.BB_HOST_DAEMON_AUTO_UPDATE,
    enrollKey: hostDaemonEntrypointConfig.BB_HOST_ENROLL_KEY,
    hostId: hostDaemonEntrypointConfig.BB_HOST_ID,
    hostName: hostDaemonEntrypointConfig.BB_HOST_NAME,
    hostType: hostDaemonEntrypointConfig.BB_HOST_TYPE,
  });
  await daemon.waitUntilStopped();
}

const entrypointPath = process.argv[1];
const isMainModule =
  typeof entrypointPath === "string" &&
  fileURLToPath(import.meta.url) === entrypointPath;

if (isMainModule) {
  const diagnosticsLogsDir = resolveDiagnosticsLogsDir();
  installSafeProcessDiagnostics({
    logsDir: diagnosticsLogsDir,
    processName: "host-daemon",
  });
  const handleMainFailure: MainFailureHandler = (error) => {
    reportStartupFailure({ diagnosticsLogsDir, error });
  };
  void runHostDaemonEntrypoint().catch(handleMainFailure);
}
