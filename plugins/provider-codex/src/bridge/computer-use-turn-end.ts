import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const COMPUTER_USE_MCP_SERVERS = new Set(["cua_repl", "computer-use"]);

const SKY_CLIENT_APP_RELATIVE_PATH = path.join(
  "computer-use",
  "Codex Computer Use.app",
  "Contents",
  "SharedSupport",
  "SkyComputerUseClient.app",
);

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

export function computerUseTurnEndedCommand(
  turnEnd: ComputerUseTurnEnd,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } | null {
  if (platform !== "darwin") return null;
  const clientApp = path.join(turnEnd.codexHome, SKY_CLIENT_APP_RELATIVE_PATH);
  if (!existsSync(clientApp)) return null;
  const payload = JSON.stringify({
    type: "agent-turn-complete",
    "thread-id": turnEnd.codexThreadId,
    "turn-id": turnEnd.turnId,
    cwd: turnEnd.cwd,
    "input-messages": [],
    "last-assistant-message": null,
  });
  return {
    command: "/usr/bin/open",
    args: ["-n", "-g", "-a", clientApp, "--args", "turn-ended", payload],
  };
}

export function endComputerUseTurn(turnEnd: ComputerUseTurnEnd): void {
  const launch = computerUseTurnEndedCommand(turnEnd);
  if (launch === null) return;
  const child = spawn(launch.command, launch.args, {
    detached: true,
    stdio: "ignore",
  });
  child.on("error", () => {});
  child.unref();
}
