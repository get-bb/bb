import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { open, realpath } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import { experimental_resolveExecutablePath as resolveExecutablePath } from "@get-bb/plugin-sdk/provider-bridge";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const COMPUTER_USE_MCP_SERVERS = new Set(["cua_repl", "computer-use"]);

const SKY_CLIENT_RELATIVE_PATH = path.join(
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "SharedSupport",
  "SkyComputerUseClient.app",
  "Contents",
  "MacOS",
  "SkyComputerUseClient",
);

const MACH_O_MAGICS = new Set([0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca]);

const LAUNCHCTL = "/bin/launchctl";
const LAUNCHD_JOB_POLL_MS = 500;
const LAUNCHD_JOB_DEADLINE_MS = 30_000;

const computerUseItemStartedSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  item: z.object({
    type: z.literal("mcpToolCall"),
    server: z.string(),
  }),
});

export function computerUseTurnFromNotification(
  method: string,
  params: unknown,
): { codexThreadId: string; turnId: string } | null {
  if (method !== "item/started") return null;
  const parsed = computerUseItemStartedSchema.safeParse(params);
  if (!parsed.success) return null;
  return COMPUTER_USE_MCP_SERVERS.has(parsed.data.item.server)
    ? { codexThreadId: parsed.data.threadId, turnId: parsed.data.turnId }
    : null;
}

export interface ComputerUseTurnEnd {
  codexHome: string;
  codexThreadId: string;
  turnId: string;
  cwd: string;
}

export function computerUseTurnEndedJob(
  turnEnd: ComputerUseTurnEnd,
  codexExecutable: string,
): { label: string; argv: string[] } {
  const payload = JSON.stringify({
    type: "agent-turn-complete",
    "thread-id": turnEnd.codexThreadId,
    "turn-id": turnEnd.turnId,
    cwd: turnEnd.cwd,
    "input-messages": [],
    "last-assistant-message": null,
  });
  return {
    label: `dev.bb.codex-computer-use-turn-ended.${turnEnd.turnId}`,
    argv: [
      codexExecutable,
      "sandbox",
      "-c",
      'sandbox_mode="danger-full-access"',
      "--",
      path.join(turnEnd.codexHome, SKY_CLIENT_RELATIVE_PATH),
      "turn-ended",
      payload,
    ],
  };
}

async function isMachO(filePath: string): Promise<boolean> {
  const file = await open(filePath, "r").catch(() => null);
  if (file === null) return false;
  try {
    const { bytesRead, buffer } = await file.read(Buffer.alloc(4), 0, 4, 0);
    return bytesRead === 4 && MACH_O_MAGICS.has(buffer.readUInt32BE(0));
  } finally {
    await file.close();
  }
}

export async function resolveCodexNativeExecutable(
  codexCommand: string,
  arch: NodeJS.Architecture = process.arch,
): Promise<string | null> {
  const executable = await resolveExecutablePath(codexCommand);
  if (executable === null) return null;
  const resolved = await realpath(executable).catch(() => null);
  if (resolved === null) return null;
  if (await isMachO(resolved)) return resolved;
  const triple = `${arch === "arm64" ? "aarch64" : "x86_64"}-apple-darwin`;
  const vendorRoots = [
    path.join(path.dirname(path.dirname(resolved)), "vendor"),
  ];
  try {
    const platformPackageJson = createRequire(resolved).resolve(
      `@openai/codex-darwin-${arch}/package.json`,
    );
    vendorRoots.unshift(path.join(path.dirname(platformPackageJson), "vendor"));
  } catch {}
  for (const vendorRoot of vendorRoots) {
    const candidate = path.join(vendorRoot, triple, "codex", "codex");
    if (await isMachO(candidate)) return candidate;
  }
  return null;
}

async function launchdJobIsRunning(label: string): Promise<boolean> {
  const { stdout } = await execFileAsync(LAUNCHCTL, ["list", label]);
  return /"PID"\s*=/u.test(stdout);
}

export async function endComputerUseTurn(
  turnEnd: ComputerUseTurnEnd,
  codexCommand: string,
): Promise<void> {
  if (process.platform !== "darwin") return;
  if (!existsSync(path.join(turnEnd.codexHome, SKY_CLIENT_RELATIVE_PATH)))
    return;
  const codexExecutable = await resolveCodexNativeExecutable(codexCommand);
  if (codexExecutable === null) return;
  const job = computerUseTurnEndedJob(turnEnd, codexExecutable);
  await execFileAsync(LAUNCHCTL, [
    "submit",
    "-l",
    job.label,
    "--",
    ...job.argv,
  ]);
  const deadline = Date.now() + LAUNCHD_JOB_DEADLINE_MS;
  while (Date.now() < deadline && (await launchdJobIsRunning(job.label))) {
    await new Promise((resolve) => setTimeout(resolve, LAUNCHD_JOB_POLL_MS));
  }
  await execFileAsync(LAUNCHCTL, ["remove", job.label]);
}
