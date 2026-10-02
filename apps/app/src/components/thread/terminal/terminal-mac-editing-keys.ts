export interface TerminalEditingKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  preventDefault: () => void;
  shiftKey: boolean;
  type: string;
}

const LINE_START = "\x01";
const LINE_END = "\x05";
const DELETE_TO_LINE_START = "\x15";
const DELETE_TO_LINE_END = "\x0b";
const WORD_BACKWARD = "\x1bb";
const WORD_FORWARD = "\x1bf";
const DELETE_WORD_FORWARD = "\x1bd";

const COMMAND_KEY_SEQUENCES: Record<string, string> = {
  ArrowLeft: LINE_START,
  ArrowRight: LINE_END,
  Backspace: DELETE_TO_LINE_START,
  Delete: DELETE_TO_LINE_END,
};

const OPTION_KEY_SEQUENCES: Record<string, string> = {
  ArrowLeft: WORD_BACKWARD,
  ArrowRight: WORD_FORWARD,
  Delete: DELETE_WORD_FORWARD,
};

function macTerminalEditingSequence(
  event: TerminalEditingKeyEvent,
): string | null {
  if (event.ctrlKey || event.shiftKey || event.metaKey === event.altKey) {
    return null;
  }
  const sequences = event.metaKey
    ? COMMAND_KEY_SEQUENCES
    : OPTION_KEY_SEQUENCES;
  return Object.hasOwn(sequences, event.key) ? sequences[event.key] : null;
}

export function handleMacTerminalEditingKey(
  event: TerminalEditingKeyEvent,
  sendInput: (sequence: string) => void,
): boolean {
  const sequence = macTerminalEditingSequence(event);
  if (sequence === null) {
    return true;
  }
  if (event.type === "keydown") {
    event.preventDefault();
    sendInput(sequence);
  }
  return false;
}
