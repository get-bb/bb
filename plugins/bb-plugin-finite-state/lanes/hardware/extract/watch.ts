import { watch, type FSWatcher } from "node:fs";
import type Database from "better-sqlite3";
import type { ArtifactScope } from "./provenance.js";
import { markArtifactsStale } from "./provenance.js";

export interface HardwareWatchOptions {
  db: Database.Database;
  scope: ArtifactScope;
  schematicPath: string;
  boardPath: string | null;
  publish(): void;
  debounceMs?: number;
}

export class HardwareSourceWatcher {
  readonly #options: HardwareWatchOptions;
  readonly #watchers: FSWatcher[] = [];
  readonly #timers = new Map<"schematic" | "board", NodeJS.Timeout>();

  constructor(options: HardwareWatchOptions) { this.#options = options; }

  start(): void {
    this.stop();
    this.#watchers.push(watch(this.#options.schematicPath, () => this.#changed("schematic")));
    if (this.#options.boardPath) this.#watchers.push(watch(this.#options.boardPath, () => this.#changed("board")));
  }

  #changed(source: "schematic" | "board"): void {
    const prior = this.#timers.get(source);
    if (prior) clearTimeout(prior);
    this.#timers.set(source, setTimeout(() => {
      this.#timers.delete(source);
      markArtifactsStale(this.#options.db, this.#options.scope, source);
      this.#options.publish();
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
