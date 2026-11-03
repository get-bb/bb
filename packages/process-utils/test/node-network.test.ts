import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { execHostFile, forkHostProcess } from "../src/index.js";
import { nodeNetworkLaunch } from "../src/node-network.js";

const FLAGS = ["--use-system-ca", "--use-env-proxy"];
const LOOPBACK = "localhost,127.0.0.1,::1,[::1]";
const supportsEnvProxy =
  process.allowedNodeEnvironmentFlags.has("--use-env-proxy");

const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()));
});

function proxyEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env))
    if (/^(?:https?|no)_proxy$/iu.test(key)) delete env[key];
  return { ...env, HTTP_PROXY: "", HTTPS_PROXY: "", NO_PROXY: "", ...values };
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener");
  return address.port;
}

async function deadPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("Missing listener");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return address.port;
}

describe("nodeNetworkLaunch", () => {
  it.each([
    ["HTTP_PROXY", "proxy.corp:3128"],
    ["http_proxy", "127.0.0.1:7890"],
    ["HTTPS_PROXY", "socks5://127.0.0.1:1080"],
    ["https_proxy", "http://"],
  ])("omits --use-env-proxy when %s=%s is not an http(s) URL", (key, value) => {
    const env = {
      HTTP_PROXY: "http://proxy.example:3128",
      NO_PROXY: "corp.example",
      [key]: value,
    };
    expect(nodeNetworkLaunch(FLAGS, env)).toEqual({
      nodeArgs: ["--use-system-ca"],
      env,
      rejectedProxyKeys: [key],
    });
  });

  it("keeps --use-env-proxy for valid proxies and appends loopback to every NO_PROXY variant", () => {
    const launch = nodeNetworkLaunch(FLAGS, {
      HTTP_PROXY: "http://proxy.example:3128",
      https_proxy: "https://user:secret@proxy.example",
      NO_PROXY: "corp.example, .internal",
      no_proxy: "",
    });
    expect(launch.nodeArgs).toEqual(FLAGS);
    expect(launch.rejectedProxyKeys).toEqual([]);
    expect(launch.env.NO_PROXY).toBe(`corp.example,.internal,${LOOPBACK}`);
    expect(launch.env.no_proxy).toBe(LOOPBACK);
  });

  it.each([
    [undefined, LOOPBACK],
    ["LOCALHOST,127.0.0.1", "LOCALHOST,127.0.0.1,::1,[::1]"],
    ["*", "*"],
  ])("turns NO_PROXY=%s into %s", (noProxy, expected) => {
    const env: NodeJS.ProcessEnv = { HTTPS_PROXY: "http://proxy.example" };
    if (noProxy !== undefined) env.NO_PROXY = noProxy;
    expect(nodeNetworkLaunch(FLAGS, env).env.NO_PROXY).toBe(expected);
  });

  it("leaves the environment alone when no proxy is configured", () => {
    const env = { NO_PROXY: "corp.example", HTTP_PROXY: "" };
    expect(nodeNetworkLaunch(FLAGS, env)).toEqual({
      nodeArgs: FLAGS,
      env,
      rejectedProxyKeys: [],
    });
  });

  it("honors NODE_USE_ENV_PROXY=0 and NODE_USE_SYSTEM_CA=0 for inherited flags", () => {
    const env = {
      HTTP_PROXY: "proxy.corp:3128",
      NODE_USE_ENV_PROXY: "0",
      NODE_USE_SYSTEM_CA: "0",
    };
    expect(nodeNetworkLaunch(["--inspect", ...FLAGS], env)).toEqual({
      nodeArgs: ["--inspect"],
      env,
      rejectedProxyKeys: [],
    });
  });
});

describe.skipIf(!supportsEnvProxy || process.platform === "win32")(
  "bb Node launches with proxies",
  () => {
    it("starts a Node process whose proxy has no scheme", async () => {
      const result = await execHostFile(
        process.execPath,
        [
          "--use-env-proxy",
          "-e",
          "console.log(JSON.stringify(process.execArgv.filter((arg) => arg.startsWith('--use-'))))",
        ],
        {
          env: proxyEnv({ HTTP_PROXY: "proxy.corp:3128" }),
        },
      );
      expect(JSON.parse(result.stdout)).toEqual([]);
    });

    it("starts a forked worker that inherits --use-env-proxy into a scheme-less proxy", async () => {
      const root = await mkdtemp(join(tmpdir(), "bb-node-network-"));
      cleanups.push(() => rm(root, { recursive: true, force: true }));
      const worker = join(root, "worker.cjs");
      await writeFile(
        worker,
        "process.send(process.execArgv, () => process.exit(0));\n",
      );
      const child = forkHostProcess(worker, [], {
        env: proxyEnv({ https_proxy: "127.0.0.1:7890" }),
        execArgv: ["--use-system-ca", "--use-env-proxy"],
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      });
      const message = await new Promise<unknown>((resolve, reject) => {
        child.once("message", resolve);
        child.once("exit", (code) =>
          reject(new Error(`worker exited with ${code}`)),
        );
      });
      expect(message).toEqual(["--use-system-ca"]);
    });

    it("reaches loopback directly while the proxy is unreachable", async () => {
      const port = await listen(
        createServer((_request, response) => response.end("direct")),
      );
      const result = await execHostFile(
        process.execPath,
        [
          "--use-env-proxy",
          "--input-type=module",
          "-e",
          `console.log(JSON.stringify(process.execArgv.filter((arg) => arg.startsWith('--use-')))); for (const url of process.argv.slice(1)) console.log(await (await fetch(url, { signal: AbortSignal.timeout(5000) })).text());`,
          `http://127.0.0.1:${port}/`,
          `http://localhost:${port}/`,
        ],
        {
          env: proxyEnv({
            HTTP_PROXY: `http://127.0.0.1:${await deadPort()}`,
            NO_PROXY: "corp.example",
          }),
          timeout: 15000,
        },
      );
      const [execArgv, ...bodies] = result.stdout.trim().split("\n");
      expect(JSON.parse(execArgv ?? "")).toEqual(["--use-env-proxy"]);
      expect(bodies).toEqual(["direct", "direct"]);
    });
  },
);
