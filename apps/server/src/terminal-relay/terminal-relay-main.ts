import { join } from "node:path";
import { Socket } from "node:net";
import { installSafeProcessDiagnostics } from "@bb/process-utils";
import { mainToTerminalRelayMessageSchema } from "./terminal-relay-ipc.js";
import {
  createTerminalRelayRuntime,
  type TerminalRelayLogger,
} from "./terminal-relay-runtime.js";

function formatLogDetail(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

const logger: TerminalRelayLogger = {
  warn: (details, message) => {
    process.send?.({
      type: "log",
      message,
      details: Object.fromEntries(
        Object.entries(details).map(([key, value]) => [
          key,
          formatLogDetail(value),
        ]),
      ),
    });
  },
};

const dataDir = process.env.BB_DATA_DIR;
installSafeProcessDiagnostics({
  logsDir: join(dataDir ?? "", "logs"),
  processName: "terminal-relay",
});
const runtime = createTerminalRelayRuntime({
  logger,
  send: (message) => {
    process.send?.(message);
  },
});
process.on("message", (raw: unknown, handle) => {
  const parsed = mainToTerminalRelayMessageSchema.safeParse(raw);
  if (!parsed.success) {
    logger.warn({ error: parsed.error }, "Invalid main-to-relay message");
    if (handle instanceof Socket) handle.destroy();
    return;
  }
  if (
    parsed.data.type === "accept-browser" ||
    parsed.data.type === "accept-daemon-data"
  ) {
    if (handle instanceof Socket) runtime.acceptSocket(parsed.data, handle);
    else logger.warn({}, "Terminal upgrade omitted socket handle");
    return;
  }
  runtime.handleMainMessage(parsed.data);
  if (parsed.data.type === "shutdown")
    setTimeout(() => process.exit(0), 500).unref();
});
process.on("disconnect", () => {
  runtime.dispose();
  process.exit(0);
});
process.send?.({ type: "ready", pid: process.pid });
