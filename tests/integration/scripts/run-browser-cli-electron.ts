import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { createServer as createNetServer } from "node:net";
import { chmod, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import {
  browserAutomationSnapshotResultSchema,
  type BrowserAutomationSnapshotNode,
} from "@bb/domain";
import { browserTargetListResponseSchema } from "@bb/server-contract";
import { createIntegrationHarness } from "../helpers/harness.js";
import { createProjectFixture, createReadyHostThread, createReadyReuseThread } from "../helpers/fixtures.js";

if (process.platform !== "darwin") throw new Error("The Browser CLI Electron boundary journey currently supports Darwin only");

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const outputRoot = await mkdtemp(join(tmpdir(), "bb-browser-cli-e2e-"));
const staticRoot = join(outputRoot, "static");
const cliPath = join(repositoryRoot, "apps/cli/bin/bb");
const experimentsOn = {
  browserAutomation: true,
  changelogPreview: false,
  editMessages: true,
  mobileApp: false,
  providerSessionReaping: false,
  timelineWindowing: false,
};
const scenarios: string[] = [];
const agentTrialFlagIndex = process.argv.indexOf("--agent-trial-server");
const agentTrialStateFile = agentTrialFlagIndex === -1 ? null : process.argv[agentTrialFlagIndex + 1] ?? null;
if (agentTrialFlagIndex !== -1 && agentTrialStateFile === null) {
  throw new Error("--agent-trial-server requires an absolute state-file path");
}
if (agentTrialStateFile !== null && !agentTrialStateFile.startsWith("/")) {
  throw new Error("--agent-trial-server state-file path must be absolute");
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string", "Failed to reserve daemon port");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

async function setExperiments(serverUrl: string, browserAutomation: boolean): Promise<void> {
  const response = await fetch(`${serverUrl}/api/v1/settings/experiments`, {
    body: JSON.stringify({ ...experimentsOn, browserAutomation }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
  assert(response.ok, `Experiment update failed: ${response.status} ${await response.text()}`);
}

async function createTargetServer(browserBundlePath: string) {
  const browserBundle = await readFile(browserBundlePath, "utf8");
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/events") {
      request.resume();
      request.on("end", () => response.writeHead(204).end());
      return;
    }
    if (url.pathname === "/fixture") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end('<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;min-height:100%;font:16px sans-serif}body{overflow-x:hidden}main{padding:16px}label,input,select,[contenteditable],button{display:block;margin:12px 0;padding:8px}[contenteditable]{border:1px solid #333;min-height:36px}.spacer{height:900px}.clipped{position:relative;left:860px;width:180px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
      return;
    }
    if (url.pathname === "/fixture.js") {
      response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      response.end(browserBundle);
      return;
    }
    if (url.pathname === "/document") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end("<!doctype html><html><body><h1>Full document ready</h1></body></html>");
      return;
    }
    response.writeHead(404).end("not found");
  });
  await new Promise<void>((resolveReady, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveReady);
  });
  const address = server.address();
  assert(address !== null && typeof address !== "string", "Target fixture did not bind");
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
    },
  };
}

type CliResult = { code: number | null; json: unknown; stderr: string; stdout: string };
async function runCli(args: string[], env: NodeJS.ProcessEnv, expectSuccess = true): Promise<CliResult> {
  const child = spawn(cliPath, args, { cwd: outputRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk));
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const code = await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`CLI timed out: bb ${args.join(" ")}`));
    }, 25_000);
    child.once("error", reject);
    child.once("exit", (exitCode) => {
      clearTimeout(timer);
      resolveExit(exitCode);
    });
  });
  const stdoutText = Buffer.concat(stdout).toString("utf8").trim();
  const stderrText = Buffer.concat(stderr).toString("utf8").trim();
  if (expectSuccess) assert(code === 0, `CLI failed: bb ${args.join(" ")}\n${stdoutText}\n${stderrText}`);
  else assert(code !== 0, `CLI unexpectedly passed: bb ${args.join(" ")}`);
  const json: unknown = stdoutText.length === 0 ? null : JSON.parse(stdoutText);
  return { code, json, stderr: stderrText, stdout: stdoutText };
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
  assert(typeof value === "object" && value !== null && !Array.isArray(value), message);
  return value as Record<string, unknown>;
}

function flatten(nodes: readonly BrowserAutomationSnapshotNode[]): BrowserAutomationSnapshotNode[] {
  const result: BrowserAutomationSnapshotNode[] = [];
  const pending = [...nodes].reverse();
  while (pending.length > 0) {
    const node = pending.pop();
    if (node === undefined) continue;
    result.push(node);
    pending.push(...[...node.children].reverse());
  }
  return result;
}

function requireRef(snapshot: ReturnType<typeof browserAutomationSnapshotResultSchema.parse>, name: string, role?: string): string {
  const node = flatten(snapshot.nodes).find((candidate) =>
    candidate.name === name && (role === undefined || candidate.role.toLowerCase() === role.toLowerCase()),
  );
  assert(typeof node?.ref === "string", `Snapshot has no current ref for ${role ?? "node"} ${name}`);
  return node.ref;
}

async function waitForLine(lines: string[], marker: string, timeoutMs = 15_000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = lines.find((line) => line.includes(marker));
    if (found !== undefined) return found;
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`Electron did not report ${marker}`);
}

let harness: Awaited<ReturnType<typeof createIntegrationHarness>> | null = null;
let targetServer: Awaited<ReturnType<typeof createTargetServer>> | null = null;
let electron: ReturnType<typeof spawn> | null = null;
let agentTrialTemporaryStateFile: string | null = null;
try {
  await mkdir(staticRoot, { recursive: true });
  await writeFile(join(staticRoot, "index.html"), '<!doctype html><html><body><main>BB Browser CLI integration renderer</main><script type="module" src="/renderer.js"></script></body></html>');
  const mainOutput = join(outputRoot, "electron-main.cjs");
  const preloadOutput = join(outputRoot, "preload.cjs");
  const browserBundle = join(outputRoot, "fixture.js");
  await Promise.all([
    build({ bundle: true, entryPoints: [join(repositoryRoot, "apps/desktop/test/fixtures/browser-cli-electron-main.ts")], external: ["electron"], format: "cjs", outfile: mainOutput, platform: "node", target: "node24" }),
    build({ bundle: true, define: { "process.env.BB_DESKTOP_VERSION": JSON.stringify("0.0.0-test") }, entryPoints: [join(repositoryRoot, "apps/desktop/src/preload.ts")], external: ["electron"], format: "cjs", outfile: preloadOutput, platform: "node", target: "node24" }),
    build({ bundle: true, entryPoints: [join(repositoryRoot, "apps/app/src/test/fixtures/browser-cli-electron-renderer.ts")], format: "esm", nodePaths: [join(repositoryRoot, "apps/app/node_modules")], outfile: join(staticRoot, "renderer.js"), platform: "browser", target: "chrome140", tsconfig: join(repositoryRoot, "apps/app/tsconfig.json") }),
    build({ bundle: true, entryPoints: [join(repositoryRoot, "apps/desktop/test/fixtures/browser-automation-page.jsx")], format: "iife", nodePaths: [join(repositoryRoot, "apps/app/node_modules")], outfile: browserBundle, platform: "browser", target: "chrome140" }),
  ]);
  targetServer = await createTargetServer(browserBundle);
  const hostDaemonPort = await freePort();
  harness = await createIntegrationHarness({ hostDaemonPort, staticDir: staticRoot });
  const project = await createProjectFixture(harness, { name: "Browser CLI E2E" });
  const primary = await createReadyHostThread(harness, { projectId: project.id, title: "Browser owner", workspace: { path: harness.repoDir, type: "unmanaged" } });
  const secondary = await createReadyReuseThread(harness, { environmentId: primary.environment.id, projectId: project.id, title: "Other thread" });
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    BB_HOST_DAEMON_PORT: String(hostDaemonPort),
    BB_SERVER_URL: harness.serverUrl,
    BB_THREAD_ID: primary.thread.id,
    BB_THREAD_STORAGE: harness.threadStorageRootPath,
  };
  delete env.BB_CLI;

  const desktopRequire = createRequire(pathToFileURL(join(repositoryRoot, "apps/desktop/package.json")));
  const electronBinary = desktopRequire("electron") as string;
  const electronStdout: string[] = [];
  const electronStderr: string[] = [];
  const electronEnv: NodeJS.ProcessEnv = { ...process.env, BB_BROWSER_CLI_PRELOAD_PATH: preloadOutput, BB_BROWSER_CLI_RENDERER_URL: `${harness.serverUrl}/?threadId=${encodeURIComponent(primary.thread.id)}`, BB_DESKTOP_VERSION: "0.0.0-test" };
  delete electronEnv.ELECTRON_RUN_AS_NODE;
  electron = spawn(electronBinary, [`--user-data-dir=${join(outputRoot, "electron-user-data")}`, mainOutput], { env: electronEnv, stdio: ["pipe", "pipe", "pipe"] });
  assert(electron.stdout !== null && electron.stderr !== null, "Electron stdio was not piped");
  electron.stdout.on("data", (chunk) => electronStdout.push(...String(chunk).split("\n").filter(Boolean)));
  electron.stderr.on("data", (chunk) => electronStderr.push(String(chunk)));
  await waitForLine(electronStdout, '"renderer-ready"');
  await setExperiments(harness.serverUrl, false);
  const disabled = await runCli(["browser", "open", `${targetServer.baseUrl}/fixture`, "--json"], env, false);
  assert(disabled.stderr.includes("unavailable") || disabled.stderr.includes("404"), `Experiment-off CLI rejection was not actionable: ${disabled.stderr} ${disabled.stdout}`);
  await setExperiments(harness.serverUrl, true);

  if (agentTrialStateFile !== null) {
    const state = {
      BB_HOST_DAEMON_PORT: env.BB_HOST_DAEMON_PORT,
      BB_SERVER_URL: env.BB_SERVER_URL,
      BB_THREAD_ID: env.BB_THREAD_ID,
      BB_THREAD_STORAGE: env.BB_THREAD_STORAGE,
      cliPath,
      fixtureUrl: `${targetServer.baseUrl}/fixture`,
    };
    agentTrialTemporaryStateFile = `${agentTrialStateFile}.${process.pid}.tmp`;
    await mkdir(dirname(agentTrialStateFile), { recursive: true });
    await writeFile(agentTrialTemporaryStateFile, `${JSON.stringify(state)}\n`, { flag: "wx", mode: 0o600 });
    await chmod(agentTrialTemporaryStateFile, 0o600);
    await rename(agentTrialTemporaryStateFile, agentTrialStateFile);
    agentTrialTemporaryStateFile = null;
    process.stdout.write(`${JSON.stringify({ agentTrialReady: true, stateFile: agentTrialStateFile })}\n`);
    await new Promise<void>((resolveStop) => {
      process.once("SIGINT", resolveStop);
      process.once("SIGTERM", resolveStop);
    });
    process.stdout.write(`${JSON.stringify({ agentTrialStopped: true })}\n`);
    process.exitCode = 0;
  } else {
  const afterDisabled = browserTargetListResponseSchema.parse((await runCli(["browser", "list", "--json"], env)).json);
  assert(afterDisabled.targets.length === 0, "Experiment-off open dispatched a Browser target");

  const opened = await runCli(["browser", "open", `${targetServer.baseUrl}/fixture`, "--json"], env);
  const targetId = requireObject(opened.json, "CLI open did not return an object").targetId;
  assert(typeof targetId === "string", "CLI open did not return a target ID");
  const listed = browserTargetListResponseSchema.parse((await runCli(["browser", "list", "--json"], env)).json);
  assert(listed.targets.length === 1 && listed.targets[0]?.targetId === targetId, "CLI list did not isolate the opened target");
  scenarios.push("fresh open and owner-isolated list");

  const initial = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  const staleControlledRef = requireRef(initial, "Controlled name", "textbox");
  await runCli(["browser", "click", targetId, "--ref", requireRef(initial, "Clipped menu trigger", "button"), "--json"], env);
  const menuSnapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  assert(flatten(menuSnapshot.nodes).some((node) => node.name.includes("Viewport menu opened")), `Offscreen click outcome was not AX-visible: ${JSON.stringify(flatten(menuSnapshot.nodes).map((node) => node.name))}`);
  scenarios.push("offscreen native menu click");

  let snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  await runCli(["browser", "type", targetId, "--ref", requireRef(snapshot, "Controlled name", "textbox"), "--text", "Ada Lovelace", "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Ada Lovelace", "--json"], env);
  snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  assert(flatten(snapshot.nodes).some((node) => node.name === "Controlled name" && node.value === "Ada Lovelace"), "Controlled input outcome was not AX-visible");
  await runCli(["browser", "type", targetId, "--ref", requireRef(snapshot, "Rich editor", "textbox"), "--text", "Rich native text", "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Rich native text", "--json"], env);
  scenarios.push("React controlled and rich-text typing");

  snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  await runCli(["browser", "select", targetId, "--ref", requireRef(snapshot, "Role", "combobox"), "--value", "Admin", "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Selected role: Admin", "--json"], env);
  snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  await runCli(["browser", "click", targetId, "--ref", requireRef(snapshot, "Keyboard target", "textbox"), "--json"], env);
  await runCli(["browser", "press", targetId, "--key", "Enter", "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Enter presses: 1", "--json"], env);
  scenarios.push("exact select and native keyboard press");

  snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  await runCli(["browser", "click", targetId, "--ref", requireRef(snapshot, "SPA after 200ms", "button"), "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "SPA route ready", "--json"], env);
  const stale = await runCli(["browser", "click", targetId, "--ref", staleControlledRef, "--json"], env, false);
  assert(stale.stderr.includes("stale"), "Stale snapshot ref was not rejected after SPA navigation");
  snapshot = browserAutomationSnapshotResultSchema.parse((await runCli(["browser", "snapshot", targetId, "--json"], env)).json);
  assert(typeof requireRef(snapshot, "Document after 200ms", "button") === "string", "Full-navigation control was not visible");
  await runCli(["browser", "navigate", targetId, `${targetServer.baseUrl}/document?from=cli`, "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Full document ready", "--json"], env);
  await runCli(["browser", "navigate", targetId, `${targetServer.baseUrl}/fixture`, "--json"], env);
  await runCli(["browser", "wait", targetId, "--text", "Native automation fixture", "--json"], env);
  scenarios.push("SPA and full navigation with stale-ref resnapshot");

  const screenshot = await runCli(["browser", "screenshot", targetId, "--json"], env);
  assert(!screenshot.stdout.includes("base64") && !screenshot.stdout.includes("iVBOR"), "PNG bytes leaked into CLI stdout");
  const screenshotJson = requireObject(screenshot.json, "Screenshot command did not return an object");
  const screenshotPath = screenshotJson.path;
  const artifact = requireObject(screenshotJson.artifact, "Screenshot command did not return artifact metadata");
  assert(typeof screenshotPath === "string", "Screenshot command did not return a materialized path");
  const bytes = await readFile(screenshotPath);
  assert(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), "Materialized screenshot is not PNG");
  assert((await stat(screenshotPath)).size === artifact.byteSize, "Screenshot bytes did not match artifact metadata");
  scenarios.push("artifact retrieval and PNG materialization without stdout bytes");

  const otherThreadEnv = { ...env, BB_THREAD_ID: secondary.thread.id };
  const crossThread = await runCli(["browser", "snapshot", targetId, "--json"], otherThreadEnv, false);
  assert(crossThread.stderr.includes("not found") || crossThread.stderr.includes("browser_target_not_found"), "Cross-thread target access was not rejected");
  const crossHost = await fetch(`${harness.serverUrl}/api/v1/browser/targets?threadId=${encodeURIComponent(primary.thread.id)}&callerHostId=host_other`);
  assert(crossHost.status === 403, `Cross-host public route returned ${crossHost.status}`);
  scenarios.push("cross-thread and cross-host rejection");

  try {
    await runCli(["browser", "close", targetId, "--json"], env);
  } finally {
    const empty = browserTargetListResponseSchema.parse((await runCli(["browser", "list", "--json"], env)).json);
    assert(empty.targets.length === 0, "CLI cleanup list was not empty");
    electron.stdin?.write(`${JSON.stringify({ targetId, type: "verify-cleanup" })}\n`);
    await waitForLine(electronStdout, '"noDebuggerOrView":true');
  }
  const electronExit = electron.exitCode ?? await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error(`Electron cleanup exit timed out\n${electronStderr.join("")}`)), 10_000);
    electron!.once("exit", (code) => { clearTimeout(timer); resolveExit(code); });
  });
  assert(electronExit === 0, `Electron exited ${electronExit}\n${electronStderr.join("")}`);
  scenarios.push("empty list and no owned view/debugger leak after close");
  process.stdout.write(`${JSON.stringify({ ok: true, scenarios })}\n`);
  }
} finally {
  if (agentTrialTemporaryStateFile !== null) await rm(agentTrialTemporaryStateFile, { force: true }).catch(() => undefined);
  if (agentTrialStateFile !== null) await rm(agentTrialStateFile, { force: true }).catch(() => undefined);
  if (electron !== null && electron.exitCode === null) electron.kill("SIGKILL");
  await harness?.cleanup().catch(() => undefined);
  await targetServer?.close().catch(() => undefined);
  await rm(outputRoot, { force: true, recursive: true });
}
