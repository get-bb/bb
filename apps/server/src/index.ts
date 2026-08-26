import { join } from "node:path";
import { loadServerConfig } from "@bb/config/server";
import { ensurePrivateDirectory } from "@bb/logger";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@bb/process-utils";

const serverConfig = loadServerConfig();
const diagnosticsLogsDir = join(serverConfig.BB_DATA_DIR, "logs");
ensurePrivateDirectory(diagnosticsLogsDir);

installSafeProcessDiagnostics({
  logsDir: diagnosticsLogsDir,
  processName: "server",
});

function reportStartupFailure(error: unknown): void {
  try {
    writeSafeProcessDiagnosticReport({
      kind: "startupFailure",
      logsDir: diagnosticsLogsDir,
      processName: "server",
      error,
    });
  } catch {
    // Keep the original startup failure visible even if diagnostic logging fails.
  }

  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  // Keep this import after diagnostics so ESM evaluation failures are reported.
  const serverModule = await import("./start-server.js");
  await serverModule.runServer(serverConfig);
}

void main().catch(reportStartupFailure);
