import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Command } from "commander";
import {
  BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES,
  BROWSER_AUTOMATION_MAX_TIMEOUT_MS,
  parseBrowserSnapshotRef,
  type BrowserAutomationCommand,
  type BrowserAutomationSnapshotNode,
} from "@bb/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import type { ContextSnapshot } from "../context-env.js";
import { resolveExplicitIdFlag } from "../context-env.js";
import { resolveLocalHostId } from "../daemon.js";
import { outputJson } from "./helpers.js";

interface BrowserOptions {
  json?: boolean;
  thread?: string;
  timeout?: string;
}

interface BrowserRefOptions extends BrowserOptions {
  ref: string;
}

function addCommonOptions(command: Command): Command {
  return command
    .option("--thread <id>", "Owning thread (defaults to BB_THREAD_ID)")
    .option("--timeout <seconds>", "Command timeout in seconds")
    .option("--json", "Print machine-readable JSON output");
}

function requireThreadId(opts: BrowserOptions, getContext: () => ContextSnapshot): string {
  const explicit = resolveExplicitIdFlag({ flagName: "--thread", value: opts.thread });
  if (explicit !== undefined) return explicit;
  const threadId = getContext().threadId;
  if (threadId !== undefined) return threadId;
  throw new Error("Missing thread ID. Pass --thread <id> or set BB_THREAD_ID.");
}

function timeoutMs(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0 || !Number.isInteger(seconds * 1000)) {
    throw new Error("--timeout must be a positive number of seconds");
  }
  return seconds * 1000;
}

function snapshotGeneration(ref: string): number {
  const parsed = parseBrowserSnapshotRef(ref);
  if (parsed === null) throw new Error("--ref must be a current Browser snapshot reference");
  return parsed.snapshotGeneration;
}

function browserSdk(baseUrl: string) {
  return createCliBbSdk(baseUrl, {
    timeoutMs: BROWSER_AUTOMATION_MAX_TIMEOUT_MS + 5_000,
  });
}

function printResult(opts: BrowserOptions, result: object, message: string): void {
  if (!outputJson(opts, result)) console.log(message);
}

async function resolveOwner(opts: BrowserOptions, getContext: () => ContextSnapshot) {
  const threadId = requireThreadId(opts, getContext);
  const callerHostId = await resolveLocalHostId();
  return { callerHostId, threadId };
}

function commandAction(args: {
  build(opts: BrowserOptions): BrowserAutomationCommand;
  getContext(): ContextSnapshot;
  getUrl(): string;
  message: string;
  opts: BrowserOptions;
  targetId: string;
}) {
  return async (): Promise<void> => {
    const result = await browserSdk(args.getUrl()).browser.run({
      ...(await resolveOwner(args.opts, args.getContext)),
      command: args.build(args.opts),
      targetId: args.targetId,
      timeoutMs: timeoutMs(args.opts.timeout),
    });
    printResult(args.opts, result, args.message);
  };
}

function renderSnapshotNodes(nodes: readonly BrowserAutomationSnapshotNode[], depth = 0): string[] {
  const lines: string[] = [];
  for (const node of nodes) {
    const ref = node.ref === undefined ? "" : ` [${node.ref}]`;
    const value = node.value === undefined ? "" : ` value=${JSON.stringify(node.value)}`;
    lines.push(`${"  ".repeat(depth)}${node.role}${ref} ${JSON.stringify(node.name)}${value}`);
    lines.push(...renderSnapshotNodes(node.children, depth + 1));
  }
  return lines;
}

async function materializeScreenshot(args: { artifactId: string; bytes: Uint8Array }): Promise<string> {
  const storage = process.env.BB_THREAD_STORAGE?.trim();
  const directory = storage ? join(storage, "browser-screenshots") : process.cwd();
  const destination = resolve(directory, `${args.artifactId}.png`);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = resolve(directory, `.${args.artifactId}.${process.pid}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(args.bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, destination);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  return destination;
}

export function registerBrowserCommands(program: Command, getUrl: () => string, getContext: () => ContextSnapshot): void {
  const browser = program.command("browser").description("Control visible BB Browser automation targets");

  addCommonOptions(browser.command("open <url>").description("Open a fresh visible Browser target")).action(action(async (url: string, opts: BrowserOptions) => {
    const target = await browserSdk(getUrl()).browser.open({
      ...(await resolveOwner(opts, getContext)),
      timeoutMs: timeoutMs(opts.timeout),
      url,
    });
    printResult(opts, target, `Opened Browser target ${target.targetId}`);
  }));

  addCommonOptions(browser.command("list").description("List Browser targets owned by a thread")).action(action(async (opts: BrowserOptions) => {
    const result = await browserSdk(getUrl()).browser.list(await resolveOwner(opts, getContext));
    if (outputJson(opts, result)) return;
    if (result.targets.length === 0) console.log("No Browser targets found");
    else for (const target of result.targets) console.log(`${target.targetId}  ${target.status}  ${target.url}`);
  }));

  addCommonOptions(browser.command("navigate <target> <url>").description("Navigate a Browser target")).action(action((targetId: string, url: string, opts: BrowserOptions) => commandAction({ build: () => ({ kind: "navigate", url }), getContext, getUrl, message: `Navigated Browser target ${targetId}`, opts, targetId })()));

  addCommonOptions(browser.command("wait <target>").description("Wait until page text is present").requiredOption("--text <text>", "Text to wait for")).action(action((targetId: string, opts: BrowserOptions & { text: string }) => commandAction({ build: () => ({ kind: "wait", text: opts.text }), getContext, getUrl, message: `Browser target ${targetId} matched`, opts, targetId })()));

  addCommonOptions(browser.command("snapshot <target>").description("Capture the accessibility snapshot")).action(action(async (targetId: string, opts: BrowserOptions) => {
    const result = await browserSdk(getUrl()).browser.run({ ...(await resolveOwner(opts, getContext)), command: { kind: "snapshot" }, targetId, timeoutMs: timeoutMs(opts.timeout) });
    if (outputJson(opts, result)) return;
    if (result.kind !== "snapshot") throw new Error("Browser snapshot returned an unexpected result");
    console.log(renderSnapshotNodes(result.nodes).join("\n"));
  }));

  addCommonOptions(browser.command("click <target>").description("Click a current snapshot reference").requiredOption("--ref <ref>", "Snapshot reference")).action(action((targetId: string, opts: BrowserRefOptions) => commandAction({ build: () => ({ kind: "click", ref: opts.ref, snapshotGeneration: snapshotGeneration(opts.ref) }), getContext, getUrl, message: `Clicked ${opts.ref}`, opts, targetId })()));

  addCommonOptions(browser.command("type <target>").description("Type text into a current snapshot reference").requiredOption("--ref <ref>", "Snapshot reference").requiredOption("--text <text>", "Text to type")).action(action((targetId: string, opts: BrowserRefOptions & { text: string }) => commandAction({ build: () => ({ kind: "type", ref: opts.ref, snapshotGeneration: snapshotGeneration(opts.ref), text: opts.text }), getContext, getUrl, message: `Typed into ${opts.ref}`, opts, targetId })()));

  addCommonOptions(browser.command("press <target>").description("Press a keyboard key").requiredOption("--key <key>", "Key to press")).action(action((targetId: string, opts: BrowserOptions & { key: string }) => commandAction({ build: () => ({ key: opts.key, kind: "press" }), getContext, getUrl, message: `Pressed ${opts.key}`, opts, targetId })()));

  addCommonOptions(browser.command("select <target>").description("Select an exact native option value").requiredOption("--ref <ref>", "Snapshot reference").requiredOption("--value <value>", "Exact option value")).action(action((targetId: string, opts: BrowserRefOptions & { value: string }) => commandAction({ build: () => ({ kind: "select", ref: opts.ref, snapshotGeneration: snapshotGeneration(opts.ref), value: opts.value }), getContext, getUrl, message: `Selected value in ${opts.ref}`, opts, targetId })()));

  addCommonOptions(browser.command("screenshot <target>").description("Capture and materialize a PNG screenshot")).action(action(async (targetId: string, opts: BrowserOptions) => {
    const sdk = browserSdk(getUrl());
    const ownership = await resolveOwner(opts, getContext);
    const result = await sdk.browser.run({ ...ownership, command: { kind: "screenshot" }, targetId, timeoutMs: timeoutMs(opts.timeout) });
    if (result.kind !== "screenshot") throw new Error("Browser screenshot returned an unexpected result");
    const bytes = await sdk.browser.downloadArtifact({ ...ownership, artifactId: result.artifact.artifactId });
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (
      bytes.byteLength !== result.artifact.byteSize ||
      bytes.byteLength === 0 ||
      bytes.byteLength > BROWSER_AUTOMATION_MAX_SCREENSHOT_BYTES ||
      signature.some((value, index) => bytes[index] !== value)
    ) {
      throw new Error("Downloaded Browser screenshot failed metadata or PNG validation");
    }
    const path = await materializeScreenshot({ artifactId: result.artifact.artifactId, bytes });
    printResult(opts, { ...result, path }, `Saved Browser screenshot ${path}`);
  }));

  addCommonOptions(browser.command("close <target>").description("Close an owned Browser target")).action(action(async (targetId: string, opts: BrowserOptions) => {
    const target = await browserSdk(getUrl()).browser.close({ ...(await resolveOwner(opts, getContext)), targetId });
    printResult(opts, target, `Closed Browser target ${targetId}`);
  }));
}
