import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";

const require = createRequire(import.meta.url);
const electronBinary = require("electron");
const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "..", "..");
const outputRoot = await mkdtemp(join(tmpdir(), "bb-browser-electron-"));
const mainOutput = join(outputRoot, "main.cjs");
const browserOutput = join(outputRoot, "page.js");
const expectedScenarios = [
  "pointer-driven menu",
  "React controlled form",
  "rich-text editor",
  "native select",
  "SPA routing",
  "full navigation",
  "delayed loading",
  "large DOM",
  "error and timeout states",
  "screenshot verification",
];

try {
  await Promise.all([
    build({
      bundle: true,
      entryPoints: [resolve(packageRoot, "test/fixtures/browser-automation-electron-main.ts")],
      external: ["electron"],
      format: "cjs",
      outfile: mainOutput,
      platform: "node",
      target: "node24",
    }),
    build({
      bundle: true,
      entryPoints: [resolve(packageRoot, "test/fixtures/browser-automation-page.jsx")],
      format: "iife",
      nodePaths: [resolve(repositoryRoot, "apps/app/node_modules")],
      outfile: browserOutput,
      platform: "browser",
      target: "chrome140",
    }),
  ]);

  const env = { ...process.env, BB_BROWSER_FIXTURE_BUNDLE: browserOutput };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(electronBinary, [`--user-data-dir=${join(outputRoot, "user-data")}`, mainOutput], {
    cwd: packageRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(String(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(String(chunk)));
  const result = await new Promise((resolveResult, rejectResult) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      rejectResult(new Error(`Electron Browser acceptance timed out.\n${stderr.join("")}`));
    }, 90_000);
    child.once("error", (error) => {
      clearTimeout(timeout);
      rejectResult(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolveResult({ code, signal });
    });
  });
  if (result.code !== 0) {
    throw new Error(`Electron Browser acceptance failed: code=${String(result.code)} signal=${String(result.signal)}\nstdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`);
  }
  const line = stdout.join("").trim().split("\n").findLast((candidate) => candidate.startsWith('{"ok":true'));
  if (line === undefined) throw new Error(`Electron Browser acceptance emitted no result.\n${stdout.join("")}\n${stderr.join("")}`);
  const report = JSON.parse(line);
  if (report.ok !== true || !Array.isArray(report.scenarios) || report.scenarios.length !== expectedScenarios.length || report.scenarios.some((scenario, index) => scenario !== expectedScenarios[index])) {
    throw new Error(`Electron Browser acceptance result did not report the exact expected scenarios: ${line}`);
  }
  process.stdout.write(`@bb/desktop: Electron Browser acceptance passed (${report.scenarios.length} scenarios)\n`);
  for (const scenario of report.scenarios) process.stdout.write(`- ${scenario}\n`);
} finally {
  await rm(outputRoot, { force: true, recursive: true });
}
