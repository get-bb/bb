import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";
import { buildNodeEsmEntry } from "../../../scripts/build-utils.mjs";

let root;
let launcher;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "bb-daemon-startup-"));
  launcher = join(root, "dist", "bb-app.js");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await buildNodeEsmEntry({
    cleanDist: false,
    entryPoint: fileURLToPath(new URL("../src/bin/bb-app.ts", import.meta.url)),
    outfile: launcher,
    packageRoot: root,
    sourcemap: false,
  });
  const bundleDir = join(root, "host-daemon", "dist");
  await mkdir(join(bundleDir, "bb-chunks"), { recursive: true });
  for (const name of [
    "bb",
    "bb-chunks/fixture.js",
    "bb-provider-bridge-worker.mjs",
    "bb-parcel-watcher-child.mjs",
    "bb-plugin-host-worker.mjs",
  ]) {
    await writeFile(join(bundleDir, name), "");
  }
  await writeFile(
    join(bundleDir, "daemon-bundle.mjs"),
    `
import { appendFileSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const starts = join(process.env.BB_DATA_DIR, "starts");
appendFileSync(starts, "started\\n");
if (readFileSync(starts, "utf8") === "started\\n") {
  if (process.env.TEST_FIRST_EXIT === "signal") {
    process.on("SIGTERM", () => process.exit(0));
    process.kill(process.ppid, "SIGTERM");
    await new Promise(() => setInterval(() => {}, 1000));
  }
  process.exit(Number(process.env.TEST_FIRST_EXIT));
}
createServer((_request, response) => {
  response.end(JSON.stringify({
    connected: true,
    hostId: process.env.BB_HOST_ID,
    serverUrl: process.env.BB_SERVER_URL,
  }));
  setTimeout(() => process.exit(0), 200);
}).listen(Number(process.env.BB_HOST_DAEMON_PORT), "127.0.0.1");
`,
  );
}, 30_000);

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it.each([75, 1, 0, "signal"])(
  "handles daemon exit %s before readiness through the launcher",
  async (firstExit) => {
    const restarts = firstExit === 75 || firstExit === 1;
    const dataDir = await mkdtemp(join(root, "data-"));
    const listener = createServer();
    await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
    const port = listener.address().port;
    await new Promise((resolve) => listener.close(resolve));
    const child = spawn(
      process.execPath,
      [
        launcher,
        "host-daemon",
        "--supervise",
        "--data-dir",
        dataDir,
        "--host-daemon-port",
        String(port),
        "--host-id",
        "startup-test",
        "--enroll-key",
        "test-enrollment",
        "--server-url",
        "https://server.example.test",
      ],
      {
        env: {
          ...Object.fromEntries(
            Object.entries(process.env).filter(
              ([key]) => !key.startsWith("BB_"),
            ),
          ),
          TEST_FIRST_EXIT: String(firstExit),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code));
    });
    const timeout = setTimeout(() => child.kill("SIGTERM"), 10_000);
    try {
      expect(await exited, output).toBe(0);
      expect(await readFile(join(dataDir, "starts"), "utf8")).toBe(
        restarts ? "started\nstarted\n" : "started\n",
      );
      expect(output.includes("bb host-daemon is ready")).toBe(restarts);
    } finally {
      clearTimeout(timeout);
      child.kill("SIGTERM");
      await exited;
    }
  },
  15_000,
);
