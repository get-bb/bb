import type { SerialLine } from "./ring-buffer.js";

export class SerialFilterError extends Error {
  readonly code = "INVALID_SERIAL_FILTER" as const;

  constructor(
    readonly pattern: string,
    readonly engineMessage: string,
  ) {
    super(`INVALID_SERIAL_FILTER: ${engineMessage}`);
    this.name = "SerialFilterError";
  }
}

export type SerialFilter = (line: SerialLine) => boolean;

export function compileSerialFilter(pattern?: string): SerialFilter {
  if (pattern === undefined || pattern.length === 0) return () => true;
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, "u");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid regular expression";
    throw new SerialFilterError(pattern, message);
  }
  return (line) => {
    expression.lastIndex = 0;
    return expression.test(line.text);
  };
}
