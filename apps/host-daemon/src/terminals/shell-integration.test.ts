import { existsSync } from "node:fs";
import os from "node:os";
import { spawn } from "node-pty";
import { describe, expect, it } from "vitest";
import {
  createTerminalCommandBlockReader,
  type TerminalCommandBlock,
} from "@bb/domain";
import type { HostDaemonLogger } from "../logger.js";
import {
  createTerminalShellIntegration,
  terminalShellIntegrationKind,
} from "./shell-integration.js";

const SETTLE_MS = 400;
const PROMPT_TIMEOUT_MS = 8_000;

const testLogger = {
  debug: () => {},
  error: () => {},
  info: () => {},
  warn: () => {},
} as unknown as HostDaemonLogger;

interface ShellProbeResult {
  blocks: TerminalCommandBlock[];
  raw: string;
}

async function runShellProbe(
  shell: string,
  commands: readonly string[],
): Promise<ShellProbeResult> {
  const integration = await createTerminalShellIntegration({
    logger: testLogger,
    shell,
    userZdotdir: undefined,
  });
  if (integration === null) {
    throw new Error(`No shell integration for ${shell}`);
  }

  const reader = createTerminalCommandBlockReader();
  let raw = "";
  let promptCount = 0;
  const pty = spawn(shell, integration.args, {
    cols: 80,
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      ...integration.env,
      HISTFILE: "",
      PS1: "probe$ ",
      TERM: "xterm-256color",
    },
    name: "xterm-256color",
    rows: 24,
  });
  pty.onData((data) => {
    raw += data;
    reader.push(data);
    promptCount += (data.match(/\u001b\]133;A/gu) ?? []).length;
  });

  const waitForPrompt = async (expected: number): Promise<void> => {
    const deadline = Date.now() + PROMPT_TIMEOUT_MS;
    while (promptCount < expected && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));
  };

  try {
    await waitForPrompt(1);
    let expectedPrompts = 1;
    for (const command of commands) {
      pty.write(`${command}\r`);
      expectedPrompts += 1;
      await waitForPrompt(expectedPrompts);
    }
  } finally {
    pty.kill();
    await integration.cleanup();
  }

  return { blocks: reader.blocks(), raw };
}

describe("terminalShellIntegrationKind", () => {
  it("recognises supported login shells by basename", () => {
    expect(terminalShellIntegrationKind("/bin/zsh")).toBe("zsh");
    expect(terminalShellIntegrationKind("/opt/homebrew/bin/bash")).toBe("bash");
  });

  it("returns null for shells without an integration", () => {
    expect(terminalShellIntegrationKind("/bin/sh")).toBeNull();
    expect(terminalShellIntegrationKind("/usr/local/bin/fish")).toBeNull();
  });
});

describe.each([
  { path: "/bin/zsh", shell: "zsh" },
  { path: "/bin/bash", shell: "bash" },
])("$shell shell integration", ({ path: shellPath }) => {
  const available = existsSync(shellPath);

  it.skipIf(!available)(
    "reports the command, its output and a zero exit code",
    async () => {
      const probe = await runShellProbe(shellPath, ["echo one && echo two"]);

      expect(probe.raw).toContain("\u001b]133;A");
      const block = probe.blocks.at(-1);
      expect(block?.command).toBe("echo one && echo two");
      expect(block?.output).toContain("one");
      expect(block?.output).toContain("two");
      expect(block?.output).not.toContain("probe$");
      expect(block?.exitCode).toBe(0);
      expect(block?.running).toBe(false);
    },
  );

  it.skipIf(!available)("reports a non-zero exit code", async () => {
    const probe = await runShellProbe(shellPath, ["/bin/sh -c 'exit 3'"]);

    expect(probe.blocks.at(-1)?.command).toBe("/bin/sh -c 'exit 3'");
    expect(probe.blocks.at(-1)?.exitCode).toBe(3);
  });

  it.skipIf(!available)("tracks the working directory", async () => {
    const probe = await runShellProbe(shellPath, ["cd /", "pwd"]);

    expect(probe.blocks.at(-1)?.cwd).toBe("/");
  });

  it.skipIf(!available)(
    "leaves the user's shell startup files in control",
    async () => {
      const probe = await runShellProbe(shellPath, [
        "printf '%s\\n' \"integration=$BB_SHELL_INTEGRATION\"",
      ]);

      expect(probe.blocks.at(-1)?.output).toContain("integration=1");
    },
  );
});
