import { promises as fs } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { JsonObject } from "@bb/domain";
import { presentationDetail } from "@bb/provider-bridge-protocol/bridge-kit";
import type {
  DeltaPresentation,
  ThreadDelta,
} from "@bb/provider-bridge-protocol";

const OMP_ADVISOR_EXTENSION_KIND = "provider-acp/advisor";
const OMP_ADVISOR_FILE_PATTERN = /^__advisor(?:\.([a-z0-9-]+))?\.jsonl$/;
const OMP_TRANSCRIPT_ID_PATTERN = /^[a-zA-Z0-9._:-]{1,128}$/;
const OMP_PROFILE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const TOOL_USE_STOP_REASONS = new Set(["toolUse", "tool_use"]);
const FAILED_STOP_REASONS = new Set(["aborted", "cancelled", "error"]);

interface OmpAdvisorNote {
  note: string;
  severity?: string;
}

interface OmpAdvisorReview {
  key: string;
  notes: OmpAdvisorNote[];
  provider: string | null;
  model: string | null;
  finalText: string | null;
}

interface TranscriptCursor {
  offset: number;
  remainder: Buffer;
  parser: OmpAdvisorTranscriptParser;
}

interface OmpAdvisorTranscriptObserverOptions {
  providerThreadId: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  emit(deltas: readonly ThreadDelta[]): void;
  ignoreExisting?: boolean;
  sessionDir?: string;
  pollIntervalMs?: number | null;
  isTurnActive?(): boolean;
}

export interface OmpAdvisorTranscriptObserver {
  start(): Promise<void>;
  prepareTurn(): Promise<void>;
  poll(): Promise<void>;
  finishTurn(): void;
  stop(): void;
}

function textContent(content: unknown): string | null {
  if (typeof content === "string") {
    return content.trim() || null;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const text = content
    .flatMap((block) => {
      if (
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string"
      ) {
        return [block.text];
      }
      return [];
    })
    .join("\n")
    .trim();
  return text || null;
}

function advisorNotes(content: unknown): OmpAdvisorNote[] {
  if (!Array.isArray(content)) {
    return [];
  }
  const notes: OmpAdvisorNote[] = [];
  for (const block of content) {
    if (
      typeof block !== "object" ||
      block === null ||
      !("type" in block) ||
      block.type !== "toolCall" ||
      !("name" in block) ||
      block.name !== "advise" ||
      !("arguments" in block) ||
      typeof block.arguments !== "object" ||
      block.arguments === null ||
      !("note" in block.arguments) ||
      typeof block.arguments.note !== "string" ||
      block.arguments.note.trim().length === 0
    ) {
      continue;
    }
    const severity =
      "severity" in block.arguments &&
      typeof block.arguments.severity === "string" &&
      block.arguments.severity.trim().length > 0
        ? block.arguments.severity.trim()
        : undefined;
    notes.push({
      note: block.arguments.note.trim(),
      ...(severity === undefined ? {} : { severity }),
    });
  }
  return notes;
}

function formatNotes(notes: readonly OmpAdvisorNote[]): string {
  return notes
    .map((note) => {
      if (note.severity === undefined) {
        return note.note;
      }
      const severity =
        note.severity.charAt(0).toUpperCase() + note.severity.slice(1);
      return `**${severity}:** ${note.note}`;
    })
    .join("\n\n");
}

function modelIdentity(review: OmpAdvisorReview): string | null {
  if (review.model === null) {
    return review.provider;
  }
  if (
    review.provider === null ||
    review.model.startsWith(`${review.provider}/`)
  ) {
    return review.model;
  }
  return `${review.provider}/${review.model}`;
}

function advisorTitle(advisor: string, identity: string | null): string {
  const advisorName = advisor === "default" ? null : advisor;
  if (advisorName !== null && identity !== null) {
    return `${advisorName} · ${identity}`;
  }
  return advisorName ?? identity ?? "Advisor";
}

function presentation(args: {
  advisor: string;
  completedLabel: string;
  detail?: string;
  identity: string | null;
}): DeltaPresentation {
  return {
    label: {
      pending: "Advisor reviewing",
      completed: args.completedLabel,
    },
    icon: { glyph: "Eye" },
    title: advisorTitle(args.advisor, args.identity),
    ...(args.detail === undefined ? {} : { detail: args.detail }),
  };
}

function payload(
  advisor: string,
  review?: OmpAdvisorReview,
  output: string | null = null,
): JsonObject {
  return {
    advisor,
    provider: review?.provider ?? null,
    model: review?.model ?? null,
    output,
    notes:
      review === undefined
        ? []
        : review.notes.map((note) => ({
            note: note.note,
            ...(note.severity === undefined ? {} : { severity: note.severity }),
          })),
  };
}

class OmpAdvisorTranscriptParser {
  private current: OmpAdvisorReview | null = null;
  private reviewSerial = 0;

  constructor(private readonly advisor: string) {}

  accept(entry: unknown): ThreadDelta[] {
    if (
      typeof entry !== "object" ||
      entry === null ||
      !("type" in entry) ||
      entry.type !== "message" ||
      !("message" in entry) ||
      typeof entry.message !== "object" ||
      entry.message === null ||
      !("role" in entry.message) ||
      typeof entry.message.role !== "string"
    ) {
      return [];
    }
    const message = entry.message;
    if (message.role === "user") {
      const update = "content" in message ? textContent(message.content) : null;
      if (update?.startsWith("### Session update") !== true) {
        return [];
      }
      const unfinished = this.interrupt();
      this.reviewSerial += 1;
      const entryId =
        "id" in entry &&
        typeof entry.id === "string" &&
        OMP_TRANSCRIPT_ID_PATTERN.test(entry.id)
          ? entry.id
          : String(this.reviewSerial);
      this.current = {
        key: `omp-advisor:${this.advisor}:${entryId}`,
        notes: [],
        provider: null,
        model: null,
        finalText: null,
      };
      return [
        ...unfinished,
        {
          kind: "item.open",
          key: { providerItemId: this.current.key },
          item: {
            type: "extension",
            kind: OMP_ADVISOR_EXTENSION_KIND,
            payload: payload(this.advisor),
          },
          presentation: presentation({
            advisor: this.advisor,
            completedLabel: "Advisor reviewed",
            identity: null,
          }),
        },
      ];
    }
    if (message.role !== "assistant" || this.current === null) {
      return [];
    }
    if (
      "provider" in message &&
      typeof message.provider === "string" &&
      message.provider.trim().length > 0
    ) {
      this.current.provider = message.provider.trim();
    }
    if (
      "model" in message &&
      typeof message.model === "string" &&
      message.model.trim().length > 0
    ) {
      this.current.model = message.model.trim();
    }
    const notes = "content" in message ? advisorNotes(message.content) : [];
    if ("content" in message) {
      this.current.notes.push(...notes);
      const finalText = textContent(message.content);
      if (finalText !== null) {
        this.current.finalText = finalText;
      }
    }
    const stopReason =
      "stopReason" in message && typeof message.stopReason === "string"
        ? message.stopReason
        : null;
    const errorMessage =
      "errorMessage" in message && typeof message.errorMessage === "string"
        ? message.errorMessage.trim()
        : "";
    const failed =
      errorMessage.length > 0 ||
      (stopReason !== null && FAILED_STOP_REASONS.has(stopReason));
    const noteOutput = formatNotes(this.current.notes);
    if (
      !failed &&
      notes.length === 0 &&
      stopReason !== null &&
      TOOL_USE_STOP_REASONS.has(stopReason)
    ) {
      return [];
    }
    const output =
      errorMessage ||
      noteOutput ||
      this.current.finalText ||
      "No advisor note.";
    return this.close(failed ? "failed" : "completed", output);
  }

  interrupt(): ThreadDelta[] {
    return this.close(
      "interrupted",
      "Advisor review stopped before responding.",
    );
  }

  private close(
    status: "completed" | "failed" | "interrupted",
    output: string,
  ): ThreadDelta[] {
    const review = this.current;
    if (review === null) {
      return [];
    }
    this.current = null;
    const identity = modelIdentity(review);
    return [
      {
        kind: "item.close",
        key: { providerItemId: review.key },
        status,
        item: {
          type: "extension",
          kind: OMP_ADVISOR_EXTENSION_KIND,
          payload: payload(this.advisor, review, output),
        },
        presentation: presentation({
          advisor: this.advisor,
          completedLabel:
            status === "failed"
              ? "Advisor failed"
              : status === "interrupted"
                ? "Advisor stopped"
                : "Advisor reviewed",
          detail: presentationDetail(output),
          identity,
        }),
      },
    ];
  }
}

function profileName(env: NodeJS.ProcessEnv): string | null {
  const raw = env.OMP_PROFILE !== undefined ? env.OMP_PROFILE : env.PI_PROFILE;
  const value = raw?.trim();
  if (
    value === undefined ||
    value === "" ||
    value === "default" ||
    !OMP_PROFILE_PATTERN.test(value)
  ) {
    return null;
  }
  return value;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function resolveOmpSessionsRoot(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const home = homedir();
  const configRoot = join(home, env.PI_CONFIG_DIR || ".omp");
  const profile = profileName(env);
  const profileRoot =
    profile === null ? configRoot : join(configRoot, "profiles", profile);
  const defaultAgentDir = join(profileRoot, "agent");
  const configuredAgentDir = env.PI_CODING_AGENT_DIR?.trim();
  const agentDir =
    profile === null && configuredAgentDir
      ? resolve(cwd, configuredAgentDir)
      : defaultAgentDir;
  const xdgRoot = env.XDG_DATA_HOME?.trim();
  if (agentDir === defaultAgentDir && xdgRoot) {
    const appRoot = join(xdgRoot, "omp");
    const profileDataRoot =
      profile === null ? appRoot : join(appRoot, "profiles", profile);
    if (await pathExists(profileDataRoot)) {
      return join(profileDataRoot, "sessions");
    }
  }
  return join(agentDir, "sessions");
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return await fs.realpath(path);
  } catch {
    return resolve(path);
  }
}

function relativeWithin(root: string, target: string): string | null {
  const value = relative(root, target);
  return value === "" || (!value.startsWith("..") && !isAbsolute(value))
    ? value
    : null;
}

function encodeRelative(prefix: string, value: string): string {
  const encoded = value.replace(/[/\\:]/g, "-");
  if (!encoded) {
    return prefix;
  }
  return prefix.endsWith("-") ? `${prefix}${encoded}` : `${prefix}-${encoded}`;
}

async function resolveOmpSessionDir(
  cwd: string,
  env: NodeJS.ProcessEnv,
): Promise<string> {
  const sessionsRoot = await resolveOmpSessionsRoot(cwd, env);
  const target = await canonicalPath(cwd);
  const home = await canonicalPath(homedir());
  const temporary = await canonicalPath(tmpdir());
  const homeRelative = relativeWithin(home, target);
  const temporaryRelative = relativeWithin(temporary, target);
  const encoded =
    homeRelative !== null
      ? encodeRelative("-", homeRelative)
      : temporaryRelative !== null
        ? encodeRelative("-tmp", temporaryRelative)
        : `--${target.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(sessionsRoot, encoded);
}

function advisorName(path: string): string | null {
  const name = basename(path);
  const match = OMP_ADVISOR_FILE_PATTERN.exec(name);
  return match === null ? null : (match[1] ?? "default");
}

class FileBackedOmpAdvisorTranscriptObserver implements OmpAdvisorTranscriptObserver {
  private active = false;
  private artifactDir: string | null = null;
  private readonly cursors = new Map<string, TranscriptCursor>();
  private shouldPrimeFirstArtifact: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;
  private polling: Promise<void> = Promise.resolve();

  constructor(private readonly options: OmpAdvisorTranscriptObserverOptions) {
    this.shouldPrimeFirstArtifact = options.ignoreExisting === true;
  }

  async start(): Promise<void> {
    if (this.active) {
      return;
    }
    this.active = true;
    await this.scan();
    const interval =
      this.options.pollIntervalMs === undefined
        ? 200
        : this.options.pollIntervalMs;
    if (interval !== null) {
      this.timer = setInterval(() => void this.poll(), interval);
      this.timer.unref?.();
    }
  }

  async prepareTurn(): Promise<void> {
    if (!this.active) {
      return;
    }
    this.polling = this.polling
      .then(async () => {
        this.cursors.clear();
        await this.scan(true);
      })
      .catch(() => undefined);
    await this.polling;
  }

  poll(): Promise<void> {
    if (!this.active || this.options.isTurnActive?.() === false) {
      return Promise.resolve();
    }
    this.polling = this.polling.then(() => this.scan()).catch(() => undefined);
    return this.polling;
  }

  finishTurn(): void {
    for (const cursor of this.cursors.values()) {
      const deltas = cursor.parser.interrupt();
      if (deltas.length > 0) {
        this.options.emit(deltas);
      }
    }
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async scan(primeExisting = false): Promise<void> {
    if (!this.active) {
      return;
    }
    if (this.artifactDir === null) {
      this.artifactDir = await this.findArtifactDir();
    }
    if (this.artifactDir === null) {
      return;
    }
    let entries;
    try {
      entries = await fs.readdir(this.artifactDir, { withFileTypes: true });
    } catch {
      this.artifactDir = null;
      return;
    }
    const prime = primeExisting || this.shouldPrimeFirstArtifact;
    for (const entry of entries) {
      if (!entry.isFile() || advisorName(entry.name) === null) {
        continue;
      }
      await this.readTranscript(join(this.artifactDir, entry.name), prime);
    }
    this.shouldPrimeFirstArtifact = false;
  }

  private async findArtifactDir(): Promise<string | null> {
    const sessionDir =
      this.options.sessionDir ??
      (await resolveOmpSessionDir(this.options.cwd, this.options.env));
    let entries;
    try {
      entries = await fs.readdir(sessionDir, { withFileTypes: true });
    } catch {
      return null;
    }
    const suffix = `_${this.options.providerThreadId}`;
    const matches = entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix))
      .map((entry) => entry.name)
      .sort();
    const match = matches.at(-1);
    return match === undefined ? null : join(sessionDir, match);
  }

  private async readTranscript(path: string, prime: boolean): Promise<void> {
    const name = advisorName(path);
    if (name === null) {
      return;
    }
    let handle;
    try {
      handle = await fs.open(path, "r");
      const stat = await handle.stat();
      let cursor = this.cursors.get(path);
      if (cursor === undefined) {
        cursor = {
          offset: prime ? stat.size : 0,
          remainder: Buffer.alloc(0),
          parser: new OmpAdvisorTranscriptParser(name),
        };
        this.cursors.set(path, cursor);
      }
      if (stat.size < cursor.offset) {
        cursor.offset = 0;
        cursor.remainder = Buffer.alloc(0);
        cursor.parser = new OmpAdvisorTranscriptParser(name);
      }
      const length = stat.size - cursor.offset;
      if (length <= 0) {
        return;
      }
      const buffer = Buffer.alloc(length);
      const result = await handle.read(buffer, 0, length, cursor.offset);
      cursor.offset += result.bytesRead;
      const combined = Buffer.concat([
        cursor.remainder,
        buffer.subarray(0, result.bytesRead),
      ]);
      let lineStart = 0;
      for (let index = 0; index < combined.length; index += 1) {
        if (combined[index] !== 0x0a) {
          continue;
        }
        const line = combined.subarray(lineStart, index).toString("utf8");
        lineStart = index + 1;
        if (line.trim().length === 0) {
          continue;
        }
        let entry: unknown;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        const deltas = cursor.parser.accept(entry);
        if (deltas.length > 0) {
          this.options.emit(deltas);
        }
      }
      cursor.remainder = Buffer.from(combined.subarray(lineStart));
    } catch {
      return;
    } finally {
      await handle?.close().catch(() => undefined);
    }
  }
}

export function createOmpAdvisorTranscriptObserver(
  options: OmpAdvisorTranscriptObserverOptions,
): OmpAdvisorTranscriptObserver {
  return new FileBackedOmpAdvisorTranscriptObserver(options);
}
