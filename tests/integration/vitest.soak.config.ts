import { defineConfig } from "vitest/config";
import { workspaceTestAliases } from "../../vitest.workspace-aliases.js";

const parsedTimeoutScale = Number(process.env.BB_TEST_TIMEOUT_SCALE ?? 1);
const timeoutScale =
  Number.isFinite(parsedTimeoutScale) && parsedTimeoutScale > 0
    ? parsedTimeoutScale
    : 1;

export default defineConfig({
  resolve: {
    conditions: ["source"],
    alias: workspaceTestAliases,
  },
  test: {
    // Soak scenarios saturate the daemon's provider-process gate and measure
    // host-wide outcomes (peak live processes, ingress round-trip latency);
    // concurrent soak files would pollute each other's measurements, so files
    // run one at a time — unlike the fake suite.
    fileParallelism: false,
    globalSetup: ["./global-setup.ts"],
    hookTimeout: Math.ceil(120_000 * timeoutScale),
    include: ["soak/**/*.test.ts"],
    name: "@bb/integration-tests:soak",
    env: {
      BB_DATA_DIR: "/tmp/bb-integration-test",
      BB_SERVER_PORT: "49161",
      BB_SERVER_URL: "http://127.0.0.1:49161",
      BB_HOST_DAEMON_PORT: "49162",
    },
    // Unlike the fake suite, console output stays on for passing tests: the
    // soak's measurement lines (peak processes, ingress p50/p95/max) are the
    // run's recorded artifact.
    testTimeout: Math.ceil(300_000 * timeoutScale),
  },
});
