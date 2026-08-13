import { watch, type FSWatcher } from "node:fs";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import type Database from "better-sqlite3";

import { rebuildOverlayIndex, type OverlayIndexReport } from "./indexer.js";

export const TRIAGE_OVERLAY_CHANGED_CHANNEL = "fs-triage-overlay-changed" as const;

export interface OverlayWatcherOptions {
  db: Database.Database;
  root: string;
  publish(channel: typeof TRIAGE_OVERLAY_CHANGED_CHANNEL, payload: null): void;
  onError?(error: unknown): void;
  onReport?(report: OverlayIndexReport): void;
  debounceMs?: number;
}

export interface OverlayWatcher {
  notify(): void;
  flush(): Promise<void>;
  close(): void;
}

class DebouncedOverlayWatcher implements OverlayWatcher {
  readonly #options: OverlayWatcherOptions;
  #timer: NodeJS.Timeout | undefined;
  #running: Promise<void> | undefined;
  #dirty = false;
  #closed = false;
  #native: FSWatcher | undefined;

  constructor(options: OverlayWatcherOptions) {
    this.#options = options;
  }

  attach(watcher: FSWatcher): void {
    this.#native = watcher;
  }

  notify(): void {
    if (this.#closed) return;
    this.#dirty = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.#run();
    }, this.#options.debounceMs ?? 75);
  }

  async #run(): Promise<void> {
    if (this.#closed || !this.#dirty) return;
    if (this.#running !== undefined) return this.#running;
    this.#dirty = false;
    this.#running = (async () => {
      try {
        const report = await rebuildOverlayIndex(this.#options.db, this.#options.root);
        this.#options.onReport?.(report);
        this.#options.publish(TRIAGE_OVERLAY_CHANGED_CHANNEL, null);
      } catch (error) {
        this.#options.onError?.(error);
      } finally {
        this.#running = undefined;
        if (this.#dirty) await this.#run();
      }
    })();
    return this.#running;
  }

  async flush(): Promise<void> {
    if (this.#timer !== undefined) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    await this.#run();
    if (this.#running !== undefined) await this.#running;
  }

  close(): void {
    this.#closed = true;
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#native?.close();
  }
}

export async function watchOverlay(options: OverlayWatcherOptions): Promise<OverlayWatcher> {
  if (!isAbsolute(options.root)) throw new Error("Overlay watcher root must be absolute");
  const root = await realpath(options.root);
  const directory = resolve(root, ".fs", "triage");
  await mkdir(directory, { recursive: true });
  const controller = new DebouncedOverlayWatcher({ ...options, root });
  const native = watch(directory, { recursive: true }, () => controller.notify());
  native.on("error", (error) => options.onError?.(error));
  controller.attach(native);
  controller.notify();
  return controller;
}

/** Testable debounce/coalescing surface for hosts that already own file observation. */
export function createOverlayWatcher(options: OverlayWatcherOptions): OverlayWatcher {
  return new DebouncedOverlayWatcher(options);
}
