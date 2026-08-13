import type { MiResultRecord, MiValue } from "./mi.js";

export interface RtosTask {
  id: string;
  name: string | null;
  state: string | null;
  priority: number | null;
  stackPointer: string | null;
}

export interface RtosTaskOptions {
  serverAware?: boolean;
  elfPath?: string;
  rtos?: "freertos" | "zephyr";
  walkSymbols?: (
    input: { elfPath: string; rtos: "freertos" | "zephyr" },
  ) => Promise<readonly RtosTask[]>;
}

type Command = (command: string, args?: readonly string[]) => Promise<MiResultRecord>;

export class RtosTasksUnavailableError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RtosTasksUnavailableError";
  }
}

function objectValue(value: MiValue | undefined): Record<string, MiValue> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

function stringValue(value: MiValue | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function numberValue(value: MiValue | undefined): number | null {
  const text = stringValue(value);
  return text !== null && /^\d+$/u.test(text) ? Number.parseInt(text, 10) : null;
}

function serverTasks(record: MiResultRecord): RtosTask[] {
  const threads = Array.isArray(record.results.threads) ? record.results.threads : [];
  return threads.flatMap((value) => {
    const row = objectValue(value);
    if (!row) return [];
    const id = stringValue(row.id);
    if (!id) return [];
    const frame = objectValue(row.frame);
    return [{
      id,
      name: stringValue(row.name) ?? stringValue(row["target-id"]),
      state: stringValue(row.state),
      priority: numberValue(row.priority),
      stackPointer: stringValue(frame?.addr),
    }];
  });
}

export async function readRtosState(
  command: Command,
  options: RtosTaskOptions = {},
): Promise<{ method: "server" | "symbols"; tasks: RtosTask[] }> {
  let serverError: unknown = null;
  if (options.serverAware !== false) {
    try {
      const tasks = serverTasks(await command("-thread-info"));
      return { method: "server", tasks };
    } catch (error) {
      serverError = error;
    }
  }
  if (options.elfPath && options.rtos && options.walkSymbols) {
    const tasks = await options.walkSymbols({ elfPath: options.elfPath, rtos: options.rtos });
    return { method: "symbols", tasks: [...tasks] };
  }
  throw new RtosTasksUnavailableError(
    "RTOS tasks are unavailable: server awareness failed and no symbol walker is configured.",
    serverError === null ? undefined : { cause: serverError },
  );
}
