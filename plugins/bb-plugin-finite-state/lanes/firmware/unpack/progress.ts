export type FirmwareProgressPhase =
  | "hashing"
  | "unpacking"
  | "validating"
  | "ingesting"
  | "complete";

export interface FirmwareProgress {
  pvId: string;
  phase: FirmwareProgressPhase;
  done: number;
  total: number;
}

export type FirmwareProgressPublisher = (progress: FirmwareProgress) => void;

export function publishFirmwareProgress(
  publish: FirmwareProgressPublisher | undefined,
  pvId: string,
  phase: FirmwareProgressPhase,
  done: number,
  total: number,
): void {
  const safeTotal = Number.isFinite(total) ? Math.max(0, Math.trunc(total)) : 0;
  const safeDone = Number.isFinite(done)
    ? Math.min(safeTotal, Math.max(0, Math.trunc(done)))
    : 0;
  try {
    publish?.({ pvId, phase, done: safeDone, total: safeTotal });
  } catch {
    // Progress is explicitly a hint. A failed listener must not fail materialization.
  }
}

export function redactHostPaths(
  value: string,
  paths: readonly string[],
): string {
  let redacted = value;
  for (const path of [...paths].sort(
    (left, right) => right.length - left.length,
  )) {
    if (path.length > 0) redacted = redacted.split(path).join("<host-path>");
  }
  return redacted.replace(/(?:^|[\s"'=])\/(?:[^\s"']+\/?)+/gu, (match) => {
    const prefix = match[0] === "/" ? "" : match[0];
    return `${prefix}<host-path>`;
  });
}

export class BoundedDiagnosticBuffer {
  readonly #limit: number;
  readonly #paths: readonly string[];
  #value = "";
  #truncated = false;

  constructor(limit: number, paths: readonly string[]) {
    this.#limit = Math.max(256, limit);
    this.#paths = paths;
  }

  append(chunk: string | Buffer): string {
    const text = redactHostPaths(chunk.toString(), this.#paths);
    this.#value += text;
    if (Buffer.byteLength(this.#value) > this.#limit) {
      const bytes = Buffer.from(this.#value);
      this.#value = bytes.subarray(bytes.length - this.#limit).toString();
      this.#truncated = true;
    }
    return text;
  }

  value(): string {
    return this.#truncated
      ? `[earlier output truncated]\n${this.#value}`
      : this.#value;
  }
}

export function parseWrapperProgress(
  text: string,
): { done: number; total: number } | null {
  const match = /(?:^|\n)PROGRESS\s+(\d+)\s+(\d+)(?:\s|$)/u.exec(text);
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  return Number.isSafeInteger(done) && Number.isSafeInteger(total) && total >= 0
    ? { done, total }
    : null;
}
