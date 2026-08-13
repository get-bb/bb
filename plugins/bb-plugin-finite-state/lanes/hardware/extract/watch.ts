import { watch, type FSWatcher } from "node:fs";
import { basename, dirname } from "node:path";

export interface HardwareWatchOptions {
  schematicPath: string;
  boardPath: string | null;
  onChange(source: "schematic" | "board"): void | Promise<void>;
  onError(error: Error): void;
  debounceMs?: number;
}

export class HardwareSourceWatcher {
  readonly #options: HardwareWatchOptions;
  readonly #watchers: FSWatcher[] = [];
  readonly #timers = new Map<"schematic" | "board", NodeJS.Timeout>();

  constructor(options: HardwareWatchOptions) { this.#options = options; }

  start(): void {
    this.stop();
    const targets = new Map<string, Map<string, "schematic" | "board">>();
    const add = (path: string, source: "schematic" | "board") => {
      const names = targets.get(dirname(path)) ?? new Map<string, "schematic" | "board">();
      names.set(basename(path), source);
      targets.set(dirname(path), names);
    };
    add(this.#options.schematicPath, "schematic");
    if (this.#options.boardPath) add(this.#options.boardPath, "board");
    for (const [directory, names] of targets) {
      const watcher = watch(directory, (_event, filename) => {
        if (filename === null) {
          for (const source of names.values()) this.#changed(source);
          return;
        }
        const source = names.get(filename.toString());
        if (source) this.#changed(source);
      });
      watcher.on("error", (error) => this.#options.onError(error));
      this.#watchers.push(watcher);
    }
  }

  #changed(source: "schematic" | "board"): void {
    const prior = this.#timers.get(source);
    if (prior) clearTimeout(prior);
    this.#timers.set(source, setTimeout(() => {
      this.#timers.delete(source);
      void Promise.resolve(this.#options.onChange(source)).catch((error) => {
        this.#options.onError(error instanceof Error ? error : new Error(String(error)));
      });
    }, this.#options.debounceMs ?? 100));
  }

  stop(): void {
    for (const watcher of this.#watchers.splice(0)) watcher.close();
    for (const timer of this.#timers.values()) clearTimeout(timer);
    this.#timers.clear();
  }
}

export function refuseAutomaticExtraction(agentRunActive: boolean): never {
  throw new Error(agentRunActive
    ? "HW_AUTO_EXTRACT_FORBIDDEN: extraction cannot run during an agent run"
    : "HW_AUTO_EXTRACT_FORBIDDEN: source changes require an explicit extraction request");
}
