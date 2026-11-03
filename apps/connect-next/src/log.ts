export type LogLevel = "info" | "warn" | "error";

export type LogFields = Record<string, string | number | boolean | null>;

export type Log = (level: LogLevel, event: string, fields?: LogFields) => void;

export function jsonLog(write: (line: string) => void): Log {
  return (level, event, fields = {}) => {
    write(
      JSON.stringify({
        ...fields,
        time: new Date().toISOString(),
        level,
        event,
      }),
    );
  };
}

export const silentLog: Log = () => {};

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
