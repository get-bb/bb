export type LocalEchoPrediction = {
  id: number;
  text: string;
  column: number;
  display: boolean;
  row: number;
};

export const TERMINAL_LOCAL_ECHO_RTT_THRESHOLD_MS = 30;

export type LocalEchoEngineOptions = {
  rttThresholdMs: number;
};

export type LocalEchoReconcilePart =
  | { type: "write"; bytes: Uint8Array }
  | { type: "confirm"; prediction: LocalEchoPrediction };

type PendingPrediction = {
  prediction: LocalEchoPrediction;
  bytes: Uint8Array;
  matched: number;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export class TerminalLocalEchoEngine {
  private pending: PendingPrediction[] = [];
  private enabled = false;
  private confirmedInEpoch = false;
  private altScreen = false;
  private waitingForOutput = false;
  private roundTripMs = 0;
  private nextId = 0;

  constructor(
    private readonly options: LocalEchoEngineOptions = {
      rttThresholdMs: TERMINAL_LOCAL_ECHO_RTT_THRESHOLD_MS,
    },
  ) {}
  get hasConfirmedEcho(): boolean {
    return this.confirmedInEpoch;
  }

  setRoundTripMs(rttMs: number): void {
    this.roundTripMs = rttMs;
    if (rttMs < this.options.rttThresholdMs) this.reset();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.reset();
  }

  setAltScreen(active: boolean): void {
    if (this.altScreen !== active) this.reset();
    this.altScreen = active;
  }

  onUserInput(
    bytes: Uint8Array,
    cursor: { column: number; row: number },
  ): LocalEchoPrediction | null {
    if (bytes.some((byte) => byte < 32 || byte === 127)) {
      this.reset();
      this.waitingForOutput = true;
      return null;
    }
    if (
      !this.enabled ||
      this.altScreen ||
      this.waitingForOutput ||
      this.roundTripMs < this.options.rttThresholdMs ||
      this.pending.length >= 64
    )
      return null;
    let text: string;
    try {
      text = decoder.decode(bytes);
    } catch {
      return null;
    }
    if (!/^(?:[\x20-\x7e]|\p{L})$/u.test(text)) return null;
    const prediction = {
      display: this.confirmedInEpoch,
      id: ++this.nextId,
      text,
      column: cursor.column,
      row: cursor.row,
    };
    this.pending.push({ prediction, bytes: encoder.encode(text), matched: 0 });
    return prediction;
  }

  reconcile(outputBytes: Uint8Array): {
    parts: LocalEchoReconcilePart[];
    rolledBack: LocalEchoPrediction[];
  } {
    const parts: LocalEchoReconcilePart[] = [];
    const rolledBack: LocalEchoPrediction[] = [];
    const appendWrite = (bytes: Uint8Array) => {
      if (bytes.length > 0) parts.push({ type: "write", bytes });
    };
    if (outputBytes.length === 0) return { parts, rolledBack };
    this.waitingForOutput = false;
    if (this.pending.length === 0) {
      this.reset();
      appendWrite(outputBytes);
      return { parts, rolledBack };
    }
    const first = this.pending[0];
    if (
      outputBytes.some(
        (byte) => byte === 0x1b || byte === 0x0a || byte === 0x0d,
      )
    ) {
      if (first?.prediction.display && first.matched > 0)
        appendWrite(first.bytes.subarray(0, first.matched));
      rolledBack.push(...this.pending.map(({ prediction }) => prediction));
      this.reset();
      appendWrite(outputBytes);
      return { parts, rolledBack };
    }
    let offset = 0;
    let writeStart: number | null = null;
    const flushWrite = (end: number) => {
      if (writeStart !== null) {
        appendWrite(outputBytes.subarray(writeStart, end));
        writeStart = null;
      }
    };
    while (offset < outputBytes.length && this.pending.length > 0) {
      const next = this.pending[0];
      if (!next) break;
      if (outputBytes[offset] !== next.bytes[next.matched]) {
        flushWrite(offset);
        rolledBack.push(...this.pending.map(({ prediction }) => prediction));
        if (next.prediction.display)
          appendWrite(next.bytes.subarray(0, next.matched));
        this.reset();
        appendWrite(outputBytes.subarray(offset));
        return { parts, rolledBack };
      }
      if (next.prediction.display) flushWrite(offset);
      else if (writeStart === null) writeStart = offset;
      next.matched++;
      offset++;
      if (next.matched === next.bytes.length) {
        this.pending.shift();
        if (next.prediction.display)
          parts.push({ type: "confirm", prediction: next.prediction });
        else {
          flushWrite(offset);
          this.confirmedInEpoch = true;
        }
      }
    }
    flushWrite(offset);
    if (offset < outputBytes.length) {
      this.reset();
      appendWrite(outputBytes.subarray(offset));
    }
    return { parts, rolledBack };
  }

  reset(): void {
    this.pending = [];
    this.waitingForOutput = false;
    this.confirmedInEpoch = false;
  }
}
