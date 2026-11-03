import { configFromEnv } from "../src/config.js";
import { errorText, jsonLog } from "../src/log.js";
import { startConnectNext } from "../src/service.js";

const log = jsonLog((line) => process.stdout.write(`${line}\n`));
const peerUrls = (process.env.BB_E2E_PEER_URLS ?? "")
  .split(",")
  .filter((url) => url !== "");

try {
  const service = await startConnectNext(configFromEnv(process.env), log, {
    resolvePeers: async () => peerUrls,
  });
  service.frps.child.once("exit", (code, signal) => {
    log("error", "frps_exited", { code, signal });
    process.exit(1);
  });
  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.once(signal, () => {
      service.frps.child.removeAllListeners("exit");
      void service.stop().finally(() => process.exit(0));
    });
  }
} catch (error) {
  log("error", "gate_failed_to_start", { error: errorText(error) });
  process.exit(1);
}
