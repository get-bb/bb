import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  getProviderCliStatus,
  inspectProviderCli,
  ProviderCliInstallInProgressError,
  streamProviderCliInstall,
  type ProviderCliCommandResult,
  type ProviderCliCommandRunner,
  type ProviderCliDefinition,
  type ProviderCliInstallProcess,
  type ProviderCliInstallProcessCloseListener,
  type ProviderCliInstallProcessErrorListener,
  type ProviderCliInstallProcessSpawner,
  type RunProviderCliCommandArgs,
  type SpawnProviderCliInstallProcessArgs,
} from "./provider-cli-health.js";
import {
  providerCliInstallEventSchema,
  type ProviderCliInstallEvent,
} from "@bb/host-daemon-contract";

interface FakeCommandBehavior {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  signal: string | null;
  errorMessage: string | null;
}

class FakeProviderCliCommandRunner implements ProviderCliCommandRunner {
  readonly calls: RunProviderCliCommandArgs[] = [];
  private readonly behaviorsByKey = new Map<string, FakeCommandBehavior>();

  setSuccess(command: string, args: readonly string[], stdout: string): void {
    this.behaviorsByKey.set(this.keyFor(command, args), {
      stdout,
      stderr: "",
      exitCode: 0,
      signal: null,
      errorMessage: null,
    });
  }

  setExit(
    command: string,
    args: readonly string[],
    exitCode: number,
    stderr: string,
  ): void {
    this.behaviorsByKey.set(this.keyFor(command, args), {
      stdout: "",
      stderr,
      exitCode,
      signal: null,
      errorMessage: null,
    });
  }

  setSpawnError(
    command: string,
    args: readonly string[],
    message: string,
  ): void {
    this.behaviorsByKey.set(this.keyFor(command, args), {
      stdout: "",
      stderr: "",
      exitCode: null,
      signal: null,
      errorMessage: message,
    });
  }

  async run(
    args: RunProviderCliCommandArgs,
  ): Promise<ProviderCliCommandResult> {
    this.calls.push(args);
    const behavior = this.behaviorsByKey.get(
      this.keyFor(args.command, args.args),
    );
    if (!behavior) {
      throw new Error(`No fake command behavior for ${this.describe(args)}`);
    }
    return {
      command: args.command,
      args: args.args,
      stdout: behavior.stdout,
      stderr: behavior.stderr,
      exitCode: behavior.exitCode,
      signal: behavior.signal,
      errorMessage: behavior.errorMessage,
    };
  }

  commandLines(): string[] {
    return this.calls.map((call) => this.describe(call));
  }

  private keyFor(command: string, args: readonly string[]): string {
    return [command, ...args].join("\0");
  }

  private describe(args: RunProviderCliCommandArgs): string {
    return [args.command, ...args.args].join(" ");
  }
}

class FakeProviderCliInstallProcess implements ProviderCliInstallProcess {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly killSignals: NodeJS.Signals[] = [];
  private readonly errorListeners: ProviderCliInstallProcessErrorListener[] =
    [];
  private readonly closeListeners: ProviderCliInstallProcessCloseListener[] =
    [];

  kill(signal: NodeJS.Signals): boolean {
    this.killSignals.push(signal);
    return true;
  }

  onError(listener: ProviderCliInstallProcessErrorListener): void {
    this.errorListeners.push(listener);
  }

  onClose(listener: ProviderCliInstallProcessCloseListener): void {
    this.closeListeners.push(listener);
  }

  emitError(error: Error): void {
    for (const listener of this.errorListeners) {
      listener(error);
    }
  }

  emitClose(exitCode: number | null, signal: NodeJS.Signals | null): void {
    for (const listener of this.closeListeners) {
      listener(exitCode, signal);
    }
  }
}

class FakeProviderCliInstallProcessSpawner implements ProviderCliInstallProcessSpawner {
  readonly processes: FakeProviderCliInstallProcess[] = [];
  readonly spawnRequests: SpawnProviderCliInstallProcessArgs[] = [];

  spawn(args: SpawnProviderCliInstallProcessArgs): ProviderCliInstallProcess {
    this.spawnRequests.push(args);
    const process = new FakeProviderCliInstallProcess();
    this.processes.push(process);
    return process;
  }

  lastProcess(): FakeProviderCliInstallProcess {
    const process = this.processes.at(-1);
    if (!process) {
      throw new Error("Expected an install process to be spawned");
    }
    return process;
  }
}

const CODEX_DEFINITION: ProviderCliDefinition = {
  key: "codex",
  displayName: "Codex",
  executableName: "codex",
  npmPackageName: "@openai/codex",
  installCommand: {
    kind: "npmGlobal",
  },
  updateCommand: {
    commandKind: "exec",
    displayCommand: "codex update",
    command: "codex",
    args: ["update"],
  },
};

const CLAUDE_CODE_DEFINITION: ProviderCliDefinition = {
  key: "claudeCode",
  displayName: "Claude Code",
  executableName: "claude",
  npmPackageName: "@anthropic-ai/claude-code",
  installCommand: {
    kind: "shell",
    command: "curl -fsSL https://claude.ai/install.sh | bash",
  },
  updateCommand: {
    commandKind: "exec",
    displayCommand: "claude update",
    command: "claude",
    args: ["update"],
  },
};

function installNpmStateCommands(
  runner: FakeProviderCliCommandRunner,
  definition: ProviderCliDefinition,
  prefix: string,
  packageVersion: string | null,
): void {
  runner.setSuccess("npm", ["prefix", "-g"], `${prefix}\n`);
  runner.setSuccess(
    "npm",
    ["list", "-g", definition.npmPackageName, "--depth=0", "--json"],
    packageVersion === null
      ? JSON.stringify({ dependencies: {} })
      : JSON.stringify({
          dependencies: {
            [definition.npmPackageName]: { version: packageVersion },
          },
        }),
  );
}

function installMissingCodexCommands(
  runner: FakeProviderCliCommandRunner,
): void {
  runner.setExit("which", ["codex"], 1, "codex not found");
  runner.setSpawnError("codex", ["--version"], "spawn codex ENOENT");
  runner.setSuccess("npm", ["view", "@openai/codex", "version"], "0.133.0\n");
  installNpmStateCommands(runner, CODEX_DEFINITION, "/usr/local", null);
}

function installMissingClaudeCommands(
  runner: FakeProviderCliCommandRunner,
): void {
  runner.setExit("which", ["claude"], 1, "claude not found");
  runner.setSpawnError("claude", ["--version"], "spawn claude ENOENT");
  runner.setSuccess(
    "npm",
    ["view", "@anthropic-ai/claude-code", "version"],
    "2.1.148\n",
  );
  installNpmStateCommands(runner, CLAUDE_CODE_DEFINITION, "/usr/local", null);
}

function installOutdatedNpmCodexCommands(
  runner: FakeProviderCliCommandRunner,
): void {
  runner.setSuccess("which", ["codex"], "/usr/local/bin/codex\n");
  runner.setSuccess("codex", ["--version"], "codex 0.132.0\n");
  runner.setSuccess("npm", ["view", "@openai/codex", "version"], "0.133.0\n");
  installNpmStateCommands(runner, CODEX_DEFINITION, "/usr/local", "0.132.0");
}

function installOutdatedExternalClaudeCommands(
  runner: FakeProviderCliCommandRunner,
): void {
  runner.setSuccess("which", ["claude"], "/opt/homebrew/bin/claude\n");
  runner.setSuccess("claude", ["--version"], "2.1.147 (Claude Code)\n");
  runner.setSuccess(
    "npm",
    ["view", "@anthropic-ai/claude-code", "version"],
    "2.1.148\n",
  );
  installNpmStateCommands(
    runner,
    CLAUDE_CODE_DEFINITION,
    "/Users/me/.npm-global",
    "2.1.147",
  );
}

function installCurrentClaudeCommands(
  runner: FakeProviderCliCommandRunner,
): void {
  runner.setSuccess("which", ["claude"], "/opt/homebrew/bin/claude\n");
  runner.setSuccess("claude", ["--version"], "2.1.148 (Claude Code)\n");
  runner.setSuccess(
    "npm",
    ["view", "@anthropic-ai/claude-code", "version"],
    "2.1.148\n",
  );
  installNpmStateCommands(
    runner,
    CLAUDE_CODE_DEFINITION,
    "/opt/homebrew",
    "2.1.148",
  );
}

async function collectInstallEvents(
  stream: ReadableStream<Uint8Array>,
): Promise<ProviderCliInstallEvent[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const events: ProviderCliInstallEvent[] = [];
  let buffer = "";

  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    buffer += decoder.decode(result.value, { stream: true });
    const lines = buffer.split(/\r?\n/u);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length > 0) {
        events.push(providerCliInstallEventSchema.parse(JSON.parse(line)));
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim().length > 0) {
    events.push(providerCliInstallEventSchema.parse(JSON.parse(buffer)));
  }
  return events;
}

describe("provider CLI health", () => {
  it("reports a missing CLI with an npm install action", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installMissingCodexCommands(runner);

    const status = await inspectProviderCli({
      definition: CODEX_DEFINITION,
      runner,
      nodePlatform: "darwin",
    });

    expect(status).toEqual({
      displayName: "Codex",
      executableName: "codex",
      executablePath: null,
      installed: false,
      installSource: "notInstalled",
      currentVersion: null,
      latestVersion: "0.133.0",
      npmPackageName: "@openai/codex",
      npmGlobalPackageVersion: null,
      installAction: {
        kind: "install",
        label: "Install",
        commandKind: "exec",
        command: "npm install -g @openai/codex@latest",
      },
      needsUpdate: false,
    });
  });

  it("reports a missing Claude Code CLI with the shell installer action", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installMissingClaudeCommands(runner);

    const status = await inspectProviderCli({
      definition: CLAUDE_CODE_DEFINITION,
      runner,
      nodePlatform: "darwin",
    });

    expect(status.installed).toBe(false);
    expect(status.installSource).toBe("notInstalled");
    expect(status.installAction).toEqual({
      kind: "install",
      label: "Install",
      commandKind: "shell",
      command: "curl -fsSL https://claude.ai/install.sh | bash",
    });
  });

  it("offers a self-update action when the active executable is npm-global", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installOutdatedNpmCodexCommands(runner);

    const status = await inspectProviderCli({
      definition: CODEX_DEFINITION,
      runner,
      nodePlatform: "darwin",
    });

    expect(status.installed).toBe(true);
    expect(status.installSource).toBe("npmGlobal");
    expect(status.currentVersion).toBe("0.132.0");
    expect(status.latestVersion).toBe("0.133.0");
    expect(status.needsUpdate).toBe(true);
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      commandKind: "exec",
      command: "codex update",
    });
  });

  it("offers a self-update action when the active executable is external", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installOutdatedExternalClaudeCommands(runner);

    const status = await inspectProviderCli({
      definition: CLAUDE_CODE_DEFINITION,
      runner,
      nodePlatform: "darwin",
    });

    expect(status.installed).toBe(true);
    expect(status.installSource).toBe("external");
    expect(status.needsUpdate).toBe(true);
    expect(status.installAction).toEqual({
      kind: "update",
      label: "Update",
      commandKind: "exec",
      command: "claude update",
    });
  });

  it("does not report an update when the CLI version matches npm latest", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installCurrentClaudeCommands(runner);

    const status = await inspectProviderCli({
      definition: CLAUDE_CODE_DEFINITION,
      runner,
      nodePlatform: "darwin",
    });

    expect(status.installed).toBe(true);
    expect(status.installSource).toBe("npmGlobal");
    expect(status.currentVersion).toBe("2.1.148");
    expect(status.latestVersion).toBe("2.1.148");
    expect(status.needsUpdate).toBe(false);
    expect(status.installAction).toBeNull();
  });

  it("returns both provider keys and queries the confirmed npm packages", async () => {
    const runner = new FakeProviderCliCommandRunner();
    installOutdatedNpmCodexCommands(runner);
    installCurrentClaudeCommands(runner);

    const status = await getProviderCliStatus({
      runner,
      nodePlatform: "darwin",
    });

    expect(status.codex.needsUpdate).toBe(true);
    expect(status.claudeCode.needsUpdate).toBe(false);
    expect(runner.commandLines()).toContain("npm view @openai/codex version");
    expect(runner.commandLines()).toContain(
      "npm view @anthropic-ai/claude-code version",
    );
  });

  it("streams failed npm installs without hiding the exit status", async () => {
    const spawner = new FakeProviderCliInstallProcessSpawner();
    const stream = streamProviderCliInstall({
      provider: "codex",
      actionKind: "install",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });
    const eventsPromise = collectInstallEvents(stream);

    spawner.lastProcess().stderr.write("permission denied\n");
    spawner.lastProcess().emitClose(1, null);

    await expect(eventsPromise).resolves.toEqual([
      {
        type: "started",
        provider: "codex",
        command: "npm install -g @openai/codex@latest",
      },
      {
        type: "output",
        provider: "codex",
        stream: "stderr",
        text: "permission denied\n",
      },
      {
        type: "completed",
        provider: "codex",
        exitCode: 1,
        signal: null,
        success: false,
      },
    ]);
    expect(spawner.spawnRequests).toEqual([
      {
        command: "npm",
        args: ["install", "-g", "@openai/codex@latest"],
      },
    ]);
  });

  it("streams Claude Code shell installs with the visible install command", async () => {
    const spawner = new FakeProviderCliInstallProcessSpawner();
    const stream = streamProviderCliInstall({
      provider: "claudeCode",
      actionKind: "install",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });
    const eventsPromise = collectInstallEvents(stream);

    spawner.lastProcess().stdout.write("installing claude\n");
    spawner.lastProcess().emitClose(0, null);

    await expect(eventsPromise).resolves.toEqual([
      {
        type: "started",
        provider: "claudeCode",
        command: "curl -fsSL https://claude.ai/install.sh | bash",
      },
      {
        type: "output",
        provider: "claudeCode",
        stream: "stdout",
        text: "installing claude\n",
      },
      {
        type: "completed",
        provider: "claudeCode",
        exitCode: 0,
        signal: null,
        success: true,
      },
    ]);
    expect(spawner.spawnRequests).toEqual([
      {
        command: "sh",
        args: ["-c", "curl -fsSL https://claude.ai/install.sh | bash"],
      },
    ]);
  });

  it("streams provider self-updates with the visible update command", async () => {
    const spawner = new FakeProviderCliInstallProcessSpawner();
    const stream = streamProviderCliInstall({
      provider: "claudeCode",
      actionKind: "update",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });
    const eventsPromise = collectInstallEvents(stream);

    spawner.lastProcess().emitClose(0, null);

    await expect(eventsPromise).resolves.toEqual([
      {
        type: "started",
        provider: "claudeCode",
        command: "claude update",
      },
      {
        type: "completed",
        provider: "claudeCode",
        exitCode: 0,
        signal: null,
        success: true,
      },
    ]);
    expect(spawner.spawnRequests).toEqual([
      {
        command: "claude",
        args: ["update"],
      },
    ]);
  });

  it("does not enqueue completion after stream cancellation", async () => {
    const spawner = new FakeProviderCliInstallProcessSpawner();
    const stream = streamProviderCliInstall({
      provider: "codex",
      actionKind: "update",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });
    const reader = stream.getReader();

    await expect(reader.read()).resolves.toMatchObject({
      done: false,
    });
    await reader.cancel();

    const process = spawner.lastProcess();
    expect(process.killSignals).toEqual(["SIGTERM"]);
    expect(() => process.emitClose(0, null)).not.toThrow();
  });

  it("rejects duplicate provider CLI installs until the active stream ends", async () => {
    const spawner = new FakeProviderCliInstallProcessSpawner();
    const firstStream = streamProviderCliInstall({
      provider: "codex",
      actionKind: "install",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });

    expect(() =>
      streamProviderCliInstall({
        provider: "claudeCode",
        actionKind: "update",
        nodePlatform: "darwin",
        installProcessSpawner: spawner,
      }),
    ).toThrow(ProviderCliInstallInProgressError);

    await firstStream.cancel();
    const secondStream = streamProviderCliInstall({
      provider: "claudeCode",
      actionKind: "update",
      nodePlatform: "darwin",
      installProcessSpawner: spawner,
    });
    await secondStream.cancel();
  });
});
