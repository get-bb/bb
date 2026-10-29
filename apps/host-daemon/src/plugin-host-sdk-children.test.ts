import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { afterEach, expect, it, vi } from "vitest";
import { PluginHostManager } from "./plugin-host-manager.js";
import { createTestResourceLedger } from "../test/resource-ledger-fixture.js";

const ENTRY = `
import { experimental_spawnHostProcess } from "./src/process.ts";
const anySchema = { "~standard": { validate(value) { return { value }; } } };
export default {
  experimental_apiVersion: 1,
  contract: {
    spawn: { input: anySchema, output: anySchema },
    crash: { input: anySchema, output: anySchema },
  },
  handlers: {
    spawn(input) {
      const child = experimental_spawnHostProcess("sleep", ["60"], {
        detached: input.detached,
        stdio: ["ignore", "ignore", input.inheritStderr ? "inherit" : "ignore"],
      });
      child.unref();
      return { pid: child.pid };
    },
    crash() {
      setTimeout(() => process.exit(17), 50);
      return {};
    },
  },
};
`;

async function bundleArtifact(): Promise<Buffer> {
  const result = await build({
    stdin: {
      contents: ENTRY,
      resolveDir: join(import.meta.dirname, "../../../packages/plugin-sdk"),
      loader: "js",
    },
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    conditions: ["source"],
    banner: {
      js: "import { createRequire as __bbCreateRequire } from 'node:module'; const require = __bbCreateRequire(import.meta.url);",
    },
  });
  return Buffer.from(result.outputFiles[0]!.contents);
}

const cleanup: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  for (const step of cleanup.splice(0).reverse()) await step();
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

interface Fixture {
  call(method: string, input: Record<string, boolean>): Promise<unknown>;
  dispose(): Promise<unknown>;
}

async function startFixture(): Promise<Fixture> {
  const artifact = await bundleArtifact();
  const dataDir = await mkdtemp(join(tmpdir(), "bb-plugin-sdk-children-"));
  const manager = new PluginHostManager({
    resourceLedger: createTestResourceLedger(),
    dataDir,
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    fetchArtifact: async () =>
      (async function* () {
        yield artifact;
      })(),
  });
  cleanup.push(async () => {
    await manager.shutdown();
    await rm(dataDir, { recursive: true, force: true });
  });
  const generation = "generation-1";
  return {
    call: async (method, input) =>
      (
        await manager.call({
          type: "plugin.host.call",
          contributedEnv: [],
          pluginId: "sdk-fixture",
          generation,
          artifact: {
            digest: createHash("sha256").update(artifact).digest("hex"),
            byteLength: artifact.byteLength,
          },
          callId: randomUUID(),
          method,
          input,
          timeoutMs: 10_000,
        })
      ).output,
    dispose: () =>
      manager.dispose({
        type: "plugin.host.dispose",
        pluginId: "sdk-fixture",
        generation,
      }),
  };
}

async function spawnReported(
  fixture: Fixture,
  input: Record<string, boolean>,
): Promise<number> {
  const pid = Number(
    Reflect.get(Object(await fixture.call("spawn", input)), "pid"),
  );
  cleanup.push(async () => {
    if (alive(pid)) process.kill(pid, "SIGKILL");
  });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  return pid;
}

it.skipIf(process.platform === "win32")(
  "stops a detached SDK child on dispose after the daemon's wall clock jumps",
  async () => {
    const fixture = await startFixture();
    const pid = await spawnReported(fixture, { detached: true });
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => realNow + 60 * 60_000);

    await fixture.dispose();
    vi.restoreAllMocks();

    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  },
  30_000,
);

it.skipIf(process.platform === "win32")(
  "stops a detached SDK child a crashed worker reported",
  async () => {
    const fixture = await startFixture();
    const pid = await spawnReported(fixture, { detached: true });

    await fixture.call("crash", {});

    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  },
  30_000,
);

it.skipIf(process.platform === "win32")(
  "stops a crashed worker's SDK child that keeps the worker's stderr open",
  async () => {
    const fixture = await startFixture();
    const pid = await spawnReported(fixture, {
      detached: false,
      inheritStderr: true,
    });

    await fixture.call("crash", {});

    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  },
  30_000,
);

it.skipIf(process.platform === "win32")(
  "stops a detached SDK child whose worker crashes right after starting it",
  async () => {
    const fixture = await startFixture();
    const pid = Number(
      Reflect.get(
        Object(await fixture.call("spawn", { detached: true })),
        "pid",
      ),
    );
    cleanup.push(async () => {
      if (alive(pid)) process.kill(pid, "SIGKILL");
    });

    await fixture.call("crash", {});

    await expect.poll(() => alive(pid), { timeout: 5_000 }).toBe(false);
  },
  30_000,
);
