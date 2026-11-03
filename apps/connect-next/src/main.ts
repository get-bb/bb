import { configFromEnv } from "./config.js";
import { errorText, jsonLog } from "./log.js";
import { startConnectNext } from "./service.js";

const log = jsonLog((line) => process.stdout.write(`${line}\n`));
const STOP_DEADLINE_MS = 8_000;

try {
  const service = await startConnectNext(configFromEnv(process.env), log);
  const onFrpsExit = (code: number | null, signal: NodeJS.Signals | null) => {
    log("error", "frps_exited", { code, signal });
    process.exit(1);
  };
  service.frps.child.once("exit", onFrpsExit);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      if (stopping) return;
      stopping = true;
      log("info", "gate_stopping", { signal });
      service.frps.child.off("exit", onFrpsExit);
      setTimeout(() => {
        log("warn", "gate_stop_timed_out", { ms: STOP_DEADLINE_MS });
        process.exit(0);
      }, STOP_DEADLINE_MS).unref();
      void service
        .stop()
        .catch((error: unknown) =>
          log("error", "gate_stop_failed", { error: errorText(error) }),
        )
        .finally(() => process.exit(0));
    });
  }
} catch (error) {
  log("error", "gate_failed_to_start", { error: errorText(error) });
  process.exit(1);
}
