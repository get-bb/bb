import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  BENCH_STREAM_LOG_DIR_ENV,
  BENCH_STREAM_MODEL,
  BENCH_STREAM_PROVIDER_ID,
} from "./src/vocabulary.js";

export default function benchStreamProvider(bb: BbPluginApi): void {
  bb.providers.register({
    id: BENCH_STREAM_PROVIDER_ID,
    displayName: "Bench stream",
    icon: "Zap",
    strings: {
      signInHint:
        "Nothing to sign in to: the bench stream provider runs offline.",
      expiredHint: "Bench stream sessions never expire.",
      installUrl:
        "https://github.com/get-bb/bb/tree/main/tests/bench-stream-provider",
    },
    maintenance: { health: true, usage: false, installation: false },
    capabilities: {
      supportsServiceTier: false,
      supportsNativeUserQuestion: false,
      fork: "tip",
      supportsManualCompaction: false,
      supportsThreadArchive: true,
      supportsThreadRename: false,
      permissionModes: ["accept-edits", "auto", "full"],
      reasoningLevels: ["medium"],
    },
    composerActions: [],
    models: { fallback: [BENCH_STREAM_MODEL], scope: "host" },
    env: { passthrough: [BENCH_STREAM_LOG_DIR_ENV] },
  });
}
