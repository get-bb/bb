import { spawn } from "node:child_process";
import {
  query,
  type CanUseTool,
  type McpSdkServerConfigWithInstance,
  type Options,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
  type SpawnedProcess,
  type SpawnOptions,
} from "@anthropic-ai/claude-agent-sdk";
import {
  experimental_isProviderBridgeRecording,
  experimental_recordProviderChildIo,
} from "@get-bb/plugin-sdk/provider-bridge";
import type { ClaudePermissionMode } from "../interactive-contract.js";
import {
  isMissingClaudeCliMessage,
  missingClaudeCliGuidance,
  translateMissingClaudeCliError,
} from "./missing-cli-error.js";

export interface SdkSessionOptions {
  cwd: string;
  systemPrompt: Exclude<Options["systemPrompt"], undefined>;
  model?: string;
  additionalDirectories?: readonly string[];
  effort?: Options["effort"];
  sessionId?: string;
  permissionMode?: ClaudePermissionMode;
  sandbox?: Options["sandbox"];
  hooks?: Options["hooks"];
  mcpServers?: Record<string, McpSdkServerConfigWithInstance>;
  allowedTools?: string[];
  disallowedTools?: string[];
  canUseTool?: CanUseTool;
  env?: NodeJS.ProcessEnv;
  pathToClaudeCodeExecutable?: Options["pathToClaudeCodeExecutable"];
  plugins?: Options["plugins"];
  thinking?: Options["thinking"];
  /** Flag-tier settings (highest user-controlled tier); BB owns this layer. */
  settings?: Options["settings"];
  /**
   * The bb thread this session serves, read when the CLI is spawned. Record
   * mode scopes the CLI's stdio recording to it; absent otherwise.
   */
  recordThreadId?: () => string;
}

export type ClaudeSdkReasoningEffort =
  | "low"
  | "medium"
  | "high"
  | "xhigh"
  | "max";

export interface ClaudeMutableFlagSettings {
  autoMemoryEnabled: boolean;
  enableWorkflows: boolean;
  effortLevel?: ClaudeSdkReasoningEffort;
  ultracode: boolean;
}

interface ClaudeMutableSettingsQueryBoundary {
  applyFlagSettings(settings: ClaudeMutableFlagSettings): Promise<void>;
}

type SdkSessionMessageHandler = (message: SDKMessage) => void;
type SdkSessionDoneHandler = (error?: unknown) => void;

interface QueuedSdkInputMessage {
  message: SDKUserMessage;
  rejectConsumed: (error: Error) => void;
  resolveConsumed: () => void;
}

interface SdkPermissionOptions {
  allowDangerouslySkipPermissions?: true;
  permissionMode: ClaudePermissionMode;
}

interface BuildSdkPermissionOptionsArgs {
  permissionMode: ClaudePermissionMode | undefined;
}

interface AppendBoundedTextArgs {
  chunk: string;
  current: string;
}

interface BuildSdkDoneErrorMessageArgs {
  error: unknown;
  stderrTail: string;
}

const SDK_STDERR_TAIL_MAX_CHARS = 4_000;

function isCurrentProcessRoot(): boolean {
  return process.getuid?.() === 0;
}

function appendBoundedText(args: AppendBoundedTextArgs): string {
  const next = `${args.current}${args.chunk}`;
  if (next.length <= SDK_STDERR_TAIL_MAX_CHARS) {
    return next;
  }
  return next.slice(next.length - SDK_STDERR_TAIL_MAX_CHARS);
}

function getErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return isMissingClaudeCliMessage(message)
    ? missingClaudeCliGuidance()
    : message;
}

function buildSdkDoneErrorMessage(args: BuildSdkDoneErrorMessageArgs): string {
  const errorMessage = getErrorMessage(args.error);
  const stderrTail = args.stderrTail.trim();
  if (stderrTail.length === 0 || errorMessage.includes(stderrTail)) {
    return errorMessage;
  }
  return `${errorMessage}\n\nClaude Code stderr:\n${stderrTail}`;
}

/**
 * Record mode's spawn of the Claude CLI. The Agent SDK owns the CLI pipe, so
 * the only way to tee it is to spawn the process ourselves through the SDK's
 * `spawnClaudeCodeProcess` seam — a byte-for-byte copy of its default spawn
 * (piped stdio, stderr forwarded to the session's tail) plus the recorder.
 * Used only when `BB_PROVIDER_BRIDGE_RECORD_DIR` is set; the default path is
 * untouched otherwise.
 */
function spawnRecordedClaudeProcess(args: {
  onStderr: (data: string) => void;
  spawnOptions: SpawnOptions;
  threadId: string | null;
}): SpawnedProcess {
  const child = spawn(args.spawnOptions.command, args.spawnOptions.args, {
    cwd: args.spawnOptions.cwd,
    env: args.spawnOptions.env,
    signal: args.spawnOptions.signal,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stderr?.setEncoding("utf8").on("data", (data: string) => {
    args.onStderr(data);
  });
  experimental_recordProviderChildIo(child, { threadId: args.threadId });
  return child as SpawnedProcess;
}

function buildSdkPermissionOptions(
  args: BuildSdkPermissionOptionsArgs,
): SdkPermissionOptions {
  const permissionMode = args.permissionMode ?? "default";
  if (permissionMode !== "bypassPermissions") {
    return { permissionMode };
  }

  // Claude Code refuses dangerous permission skipping under root. Keep bb's
  // logical bypass policy in the bridge canUseTool handler, but avoid sending
  // the SDK flags that make the CLI exit before the session starts.
  if (isCurrentProcessRoot()) {
    return { permissionMode: "default" };
  }

  return {
    permissionMode,
    allowDangerouslySkipPermissions: true,
  };
}

export class SdkSession {
  private query: Query | undefined;
  private sessionId: string | undefined;
  private inputResolve:
    | ((value: IteratorResult<SDKUserMessage>) => void)
    | null = null;
  private readonly inputQueue: QueuedSdkInputMessage[] = [];
  private inputDone = false;
  private readonly abortController = new AbortController();
  private readonly completion: Promise<void>;
  private complete: (() => void) | null = null;
  private stderrTail = "";

  constructor(
    private readonly options: SdkSessionOptions,
    private readonly onMessage: SdkSessionMessageHandler,
    private readonly onDone: SdkSessionDoneHandler,
  ) {
    this.completion = new Promise((resolve) => {
      this.complete = resolve;
    });
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }

  canPushInput(): boolean {
    return !this.inputDone;
  }

  /**
   * Change the permission mode of the live session. Used to leave Plan mode
   * once the user approves a plan. The new mode is also recorded on the
   * session options so a later resume rebuilds the session with it.
   *
   * Only streaming-input sessions accept the control request, and only while
   * the query is open, so a closed session records the mode and returns.
   */
  async setPermissionMode(mode: ClaudePermissionMode): Promise<void> {
    this.options.permissionMode = mode;
    await this.query?.setPermissionMode(mode);
  }

  async setModel(model: string | undefined): Promise<void> {
    await this.query?.setModel(model);
    this.options.model = model;
  }

  async applyMutableSettings(args: {
    effort: ClaudeSdkReasoningEffort | undefined;
    settings: ClaudeMutableFlagSettings;
  }): Promise<void> {
    // Claude CLI accepts `max` through apply_flag_settings (and reports max
    // from its hook context), but Agent SDK 0.3.197's Settings type omits it.
    // Keep the compatibility assertion at this external SDK boundary.
    await (
      this.query as ClaudeMutableSettingsQueryBoundary | undefined
    )?.applyFlagSettings(args.settings);
    this.options.effort = args.effort;
    const { effortLevel: _effortLevel, ...sessionSettings } = args.settings;
    const currentSettings =
      typeof this.options.settings === "object" ? this.options.settings : {};
    this.options.settings = {
      ...currentSettings,
      ...sessionSettings,
    };
  }

  start(resumeSessionId?: string): void {
    if (resumeSessionId) {
      this.sessionId = resumeSessionId;
    } else if (this.options.sessionId) {
      this.sessionId = this.options.sessionId;
    }

    this.stderrTail = "";
    const permissionOptions = buildSdkPermissionOptions({
      permissionMode: this.options.permissionMode,
    });
    const onStderr = (data: string): void => {
      this.stderrTail = appendBoundedText({
        current: this.stderrTail,
        chunk: data,
      });
    };
    const recordThreadId = this.options.recordThreadId;
    const sdkOptions: Options = {
      abortController: this.abortController,
      cwd: this.options.cwd,
      systemPrompt: this.options.systemPrompt,
      ...permissionOptions,
      ...(experimental_isProviderBridgeRecording()
        ? {
            spawnClaudeCodeProcess: (spawnOptions: SpawnOptions) =>
              spawnRecordedClaudeProcess({
                onStderr,
                spawnOptions,
                threadId: recordThreadId?.() ?? null,
              }),
          }
        : {}),
      includePartialMessages: true,
      // Mirror the Claude CLI cascade so the SDK loads both the user's global
      // configuration (~/.claude/settings.json, ~/.claude/CLAUDE.md) and the
      // workspace's project and local settings. Restricting this to "project"
      // hid global home configuration from bb-managed sessions.
      settingSources: ["user", "project", "local"],
      persistSession: true,
      env: this.options.env ?? process.env,
      stderr: onStderr,
      ...(this.options.mcpServers
        ? { mcpServers: this.options.mcpServers }
        : {}),
      ...(this.options.allowedTools
        ? { allowedTools: this.options.allowedTools }
        : {}),
      ...(this.options.disallowedTools
        ? { disallowedTools: this.options.disallowedTools }
        : {}),
      ...(this.options.canUseTool
        ? { canUseTool: this.options.canUseTool }
        : {}),
      ...(this.options.sandbox ? { sandbox: this.options.sandbox } : {}),
      ...(this.options.hooks ? { hooks: this.options.hooks } : {}),
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
      ...(!resumeSessionId && this.options.sessionId
        ? { sessionId: this.options.sessionId }
        : {}),
      ...(this.options.model ? { model: this.options.model } : {}),
      ...(this.options.additionalDirectories
        ? { additionalDirectories: [...this.options.additionalDirectories] }
        : {}),
      ...(this.options.effort ? { effort: this.options.effort } : {}),
      ...(this.options.pathToClaudeCodeExecutable
        ? {
            pathToClaudeCodeExecutable: this.options.pathToClaudeCodeExecutable,
          }
        : {}),
      ...(this.options.plugins ? { plugins: this.options.plugins } : {}),
      ...(this.options.thinking ? { thinking: this.options.thinking } : {}),
      ...(this.options.settings ? { settings: this.options.settings } : {}),
    };

    try {
      this.query = query({
        prompt: this.createInputIterable(),
        options: sdkOptions,
      });
    } catch (error) {
      throw translateMissingClaudeCliError(error);
    }

    void this.consumeStream();
  }

  pushInput(
    text: string,
    promptId?: NonNullable<SDKUserMessage["uuid"]>,
  ): Promise<void> {
    const message: SDKUserMessage = {
      type: "user",
      message: { role: "user", content: text },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? "",
      ...(promptId !== undefined ? { uuid: promptId } : {}),
    };

    if (this.inputDone) {
      return Promise.reject(new Error("Claude SDK input stream is closed"));
    }

    let resolveConsumed = (): void => {};
    let rejectConsumed = (_error: Error): void => {};
    const consumed = new Promise<void>((resolve, reject) => {
      resolveConsumed = resolve;
      rejectConsumed = reject;
    });

    if (this.inputResolve) {
      const resolve = this.inputResolve;
      this.inputResolve = null;
      resolve({ value: message, done: false });
      resolveConsumed();
      return consumed;
    }

    this.inputQueue.push({
      message,
      rejectConsumed,
      resolveConsumed,
    });
    return consumed;
  }

  stop(): void {
    this.inputDone = true;
    this.rejectQueuedInputs("Claude SDK session stopped before input consumed");
    this.resolveInputDone();
    this.abortController.abort();
    this.query?.close();
    this.query = undefined;
  }

  async closeGracefully(timeoutMs: number): Promise<void> {
    this.inputDone = true;
    this.rejectQueuedInputs("Claude SDK session closed before input consumed");
    this.resolveInputDone();

    if (!this.query) {
      return;
    }

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.completion,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(() => {
            reject(
              new Error(
                `Claude SDK session did not close within ${timeoutMs}ms`,
              ),
            );
          }, timeoutMs);
        }),
      ]);
    } catch {
      this.stop();
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private createInputIterable(): AsyncIterable<SDKUserMessage> {
    const self = this;
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<SDKUserMessage>> {
            if (self.inputQueue.length > 0) {
              const queued = self.inputQueue.shift();
              if (!queued) {
                return { value: undefined, done: true };
              }
              queued.resolveConsumed();
              return { value: queued.message, done: false };
            }
            if (self.inputDone) {
              return { value: undefined, done: true };
            }
            return new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
              self.inputResolve = resolve;
            });
          },
          async return(): Promise<IteratorResult<SDKUserMessage>> {
            self.inputDone = true;
            self.rejectQueuedInputs(
              "Claude SDK input iterator closed before input consumed",
            );
            self.resolveInputDone();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  private resolveInputDone(): void {
    if (!this.inputResolve) return;
    const resolve = this.inputResolve;
    this.inputResolve = null;
    resolve({ value: undefined, done: true });
  }

  private rejectQueuedInputs(message: string): void {
    const error = new Error(message);
    while (this.inputQueue.length > 0) {
      const queued = this.inputQueue.shift();
      if (!queued) {
        return;
      }
      queued.rejectConsumed(error);
    }
  }

  private async consumeStream(): Promise<void> {
    const q = this.query;
    if (!q) return;

    try {
      for await (const message of q) {
        this.captureSessionId(message);
        this.onMessage(message);
      }
      this.onDone();
    } catch (error) {
      this.onDone(
        new Error(
          buildSdkDoneErrorMessage({
            error,
            stderrTail: this.stderrTail,
          }),
        ),
      );
    } finally {
      this.inputDone = true;
      this.rejectQueuedInputs("Claude SDK stream ended before input consumed");
      this.resolveInputDone();
      this.query = undefined;
      if (this.complete) {
        this.complete();
        this.complete = null;
      }
    }
  }

  private captureSessionId(message: SDKMessage): void {
    const { session_id } = message;
    const providerThreadId = session_id?.trim() ?? "";
    if (providerThreadId.length > 0) {
      this.sessionId = providerThreadId;
    }
  }
}
