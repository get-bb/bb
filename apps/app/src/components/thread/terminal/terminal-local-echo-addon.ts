import {
  TerminalLocalEchoEngine,
  TERMINAL_LOCAL_ECHO_RTT_THRESHOLD_MS,
  type LocalEchoPrediction,
} from "@bb/client-core";
import type { Terminal } from "@xterm/xterm";

const encoder = new TextEncoder();

type PredictedCell = {
  prediction: LocalEchoPrediction;
  previous: string;
  width: number;
};

export class TerminalLocalEchoAddon {
  private readonly engine = new TerminalLocalEchoEngine();
  private readonly cells: PredictedCell[] = [];
  private nextColumn: number | null = null;
  private nextRow: number | null = null;

  constructor(private readonly terminal: Terminal) {}

  setEnabled(enabled: boolean): void {
    if (!enabled) this.reset();
    this.engine.setEnabled(enabled);
  }

  setRoundTripMs(rttMs: number): void {
    if (rttMs < TERMINAL_LOCAL_ECHO_RTT_THRESHOLD_MS) this.reset();
    this.engine.setRoundTripMs(rttMs);
  }

  reset(): void {
    for (const cell of this.cells) {
      if (cell.prediction.display)
        this.paint(cell.prediction, cell.previous, false);
    }
    this.cells.length = 0;
    this.nextColumn = null;
    this.nextRow = null;
    this.engine.reset();
  }

  onUserInput(data: string): void {
    const buffer = this.terminal.buffer.active;
    if (buffer.type === "alternate") {
      this.reset();
      this.engine.setAltScreen(true);
      return;
    }
    this.engine.setAltScreen(false);
    const column =
      this.nextRow === buffer.cursorY && this.nextColumn !== null
        ? this.nextColumn
        : buffer.cursorX;
    const bytes = encoder.encode(data);
    if (/[\x00-\x1f\x7f]/.test(data)) {
      this.reset();
      this.engine.onUserInput(bytes, { column, row: buffer.cursorY });
      return;
    }
    const width =
      /[\u1100-\u115f\u2e80-\ua4cf\uac00-\ud7a3\uf900-\ufaff\uff01-\uff60]/u.test(
        data,
      ) || (data.codePointAt(0) ?? 0) >= 0x20000
        ? 2
        : 1;
    if (column + width >= this.terminal.cols) return;
    const prediction = this.engine.onUserInput(bytes, {
      column,
      row: buffer.cursorY,
    });
    if (prediction === null) return;
    if (prediction.display) {
      const line = buffer.getLine(buffer.baseY + buffer.cursorY);
      const first = line?.getCell(column);
      const previous =
        first?.getWidth() === 2
          ? first.getChars()
          : (first?.getChars() || " ") +
            (width === 2 ? line?.getCell(column + 1)?.getChars() || " " : "");
      const cell = { prediction, previous, width };
      this.cells.push(cell);
      this.paint(prediction, prediction.text, true);
    }
    this.nextColumn = column + width;
    this.nextRow = buffer.cursorY;
  }

  reconcile(bytes: Uint8Array): Uint8Array {
    if (this.terminal.buffer.active.type === "alternate") {
      this.reset();
      this.engine.setAltScreen(true);
      return bytes;
    }
    this.engine.setAltScreen(false);
    const result = this.engine.reconcile(bytes);
    const outputParts: Uint8Array[] = [];
    let outputLength = 0;
    const appendOutput = (part: Uint8Array) => {
      if (part.length === 0) return;
      outputParts.push(part);
      outputLength += part.length;
    };
    for (const part of result.parts) {
      if (part.type === "write") {
        appendOutput(part.bytes);
        continue;
      }
      const cell = this.removeCell(part.prediction);
      if (cell) appendOutput(encoder.encode(this.confirmSequence(cell)));
    }
    for (const prediction of result.rolledBack) {
      const cell = this.removeCell(prediction);
      if (cell) this.paint(prediction, cell.previous, false);
    }
    if (
      result.rolledBack.length > 0 ||
      (this.cells.length === 0 && !this.engine.hasConfirmedEcho)
    ) {
      this.nextColumn = null;
      this.nextRow = null;
    }
    if (outputParts.length === 0) return new Uint8Array();
    if (outputParts.length === 1) return outputParts[0]!;
    const output = new Uint8Array(outputLength);
    let offset = 0;
    for (const part of outputParts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  private removeCell(prediction: LocalEchoPrediction): PredictedCell | null {
    const index = this.cells.findIndex(
      (cell) => cell.prediction.id === prediction.id,
    );
    if (index === -1) return null;
    const [cell] = this.cells.splice(index, 1);
    return cell ?? null;
  }

  private confirmSequence(cell: PredictedCell): string {
    const { prediction, width } = cell;
    return `${this.paintSequence(prediction, prediction.text, false)}\x1b[${prediction.row + 1};${prediction.column + width + 1}H`;
  }

  private paint(
    prediction: LocalEchoPrediction,
    text: string,
    predicted: boolean,
  ): void {
    this.terminal.write(this.paintSequence(prediction, text, predicted));
  }

  private paintSequence(
    prediction: LocalEchoPrediction,
    text: string,
    predicted: boolean,
  ): string {
    const content = text || " ";
    return `\x1b7\x1b[${prediction.row + 1};${prediction.column + 1}H\x1b[${predicted ? "2;4" : "0"}m${content}\x1b[0m\x1b8`;
  }
}
