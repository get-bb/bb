import { useSyncExternalStore } from "react";
import {
  createStore,
  del,
  getMany,
  keys,
  set,
  type UseStore,
} from "idb-keyval";
import { z } from "zod";

export type VoiceDelivery = "insert" | "send";

export interface VoiceRecording {
  id: string;
  key: string;
  file: File;
  promptContext: string | undefined;
  delivery: VoiceDelivery;
  createdAt: number;
}

export interface FailedVoiceRecording extends VoiceRecording {
  errorMessage: string | null;
  retrying: boolean;
}

interface VoiceRecordingEntry {
  recording: VoiceRecording;
  persisted: boolean;
  retryController: AbortController | null;
  status: "transcribing" | "failed" | "retrying";
  errorMessage: string | null;
}

const storedRecordingSchema = z.object({
  id: z.string().min(1),
  key: z.string().min(1),
  audio: z.custom<ArrayBuffer>(
    (value) => Object.prototype.toString.call(value) === "[object ArrayBuffer]",
  ),
  mimeType: z.string(),
  fileName: z.string().min(1),
  promptContext: z.string().nullable(),
  delivery: z.enum(["insert", "send"]),
  createdAt: z.number(),
});

type StoredRecording = z.infer<typeof storedRecordingSchema>;

const EMPTY_RECORDINGS: readonly FailedVoiceRecording[] = [];
const entries = new Map<string, VoiceRecordingEntry>();
const snapshots = new Map<string, readonly FailedVoiceRecording[]>();
const listeners = new Set<() => void>();
const hydratedKeys = new Set<string>();
let database: UseStore | null | undefined;
let databaseQueue: Promise<void> = Promise.resolve();

function enqueueDatabaseTask(
  task: (store: UseStore) => Promise<void>,
): Promise<void> {
  if (database === undefined) {
    database =
      typeof indexedDB === "undefined"
        ? null
        : createStore("bb-voice-recordings", "recordings");
  }
  const store = database;
  if (!store) return databaseQueue;
  databaseQueue = databaseQueue.then(() => task(store)).catch(() => {});
  return databaseQueue;
}

function notify(key: string): void {
  snapshots.delete(key);
  for (const listener of [...listeners]) listener();
}

function readSnapshot(key: string): readonly FailedVoiceRecording[] {
  const cached = snapshots.get(key);
  if (cached) return cached;
  const failed: FailedVoiceRecording[] = [];
  for (const entry of entries.values()) {
    if (entry.recording.key !== key || entry.status === "transcribing") {
      continue;
    }
    failed.push({
      ...entry.recording,
      errorMessage: entry.errorMessage,
      retrying: entry.status === "retrying",
    });
  }
  failed.sort((left, right) => left.createdAt - right.createdAt);
  const snapshot = failed.length === 0 ? EMPTY_RECORDINGS : failed;
  snapshots.set(key, snapshot);
  return snapshot;
}

function hydrate(key: string): void {
  if (hydratedKeys.has(key)) return;
  hydratedKeys.add(key);
  void enqueueDatabaseTask(async (store) => {
    const storedKeys = (await keys<IDBValidKey>(store)).filter(
      (storedKey) => Array.isArray(storedKey) && storedKey[0] === key,
    );
    let restored = false;
    for (const row of await getMany<unknown>(storedKeys, store)) {
      const parsed = storedRecordingSchema.safeParse(row);
      if (!parsed.success || entries.has(parsed.data.id)) continue;
      const { audio, mimeType, fileName, promptContext, ...recording } =
        parsed.data;
      entries.set(recording.id, {
        recording: {
          ...recording,
          file: new File([audio], fileName, { type: mimeType }),
          promptContext: promptContext ?? undefined,
        },
        persisted: true,
        retryController: null,
        status: "failed",
        errorMessage: null,
      });
      restored = true;
    }
    if (restored) notify(key);
  });
}

export function useFailedVoiceRecordings(
  key: string,
): readonly FailedVoiceRecording[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      hydrate(key);
      return () => listeners.delete(listener);
    },
    () => readSnapshot(key),
    () => EMPTY_RECORDINGS,
  );
}

export function saveVoiceRecording(
  recording: Omit<VoiceRecording, "id" | "createdAt">,
  options: { persist: boolean },
): VoiceRecording {
  const createdAt = Date.now();
  const saved: VoiceRecording = {
    ...recording,
    id: `${createdAt.toString(36)}-${Math.random().toString(36).slice(2)}`,
    createdAt,
  };
  entries.set(saved.id, {
    recording: saved,
    persisted: options.persist,
    retryController: null,
    status: "transcribing",
    errorMessage: null,
  });
  notify(saved.key);
  if (options.persist) {
    void enqueueDatabaseTask(async (store) => {
      if (!entries.has(saved.id)) return;
      const stored: StoredRecording = {
        id: saved.id,
        key: saved.key,
        audio: await saved.file.arrayBuffer(),
        mimeType: saved.file.type,
        fileName: saved.file.name,
        promptContext: saved.promptContext ?? null,
        delivery: saved.delivery,
        createdAt: saved.createdAt,
      };
      await set([saved.key, saved.id], stored, store);
    });
  }
  return saved;
}

export function startVoiceRecordingRetry(id: string): AbortSignal | null {
  const entry = entries.get(id);
  if (!entry || entry.status !== "failed") return null;
  const controller = new AbortController();
  entry.retryController = controller;
  entry.status = "retrying";
  notify(entry.recording.key);
  return controller.signal;
}

export function finishVoiceRecordingRetry(
  id: string,
  signal: AbortSignal,
): boolean {
  const entry = entries.get(id);
  if (!entry || entry.retryController?.signal !== signal || signal.aborted) {
    return false;
  }
  entry.retryController = null;
  entry.status = "failed";
  notify(entry.recording.key);
  return true;
}

export function failVoiceRecording(id: string, errorMessage: string): void {
  const entry = entries.get(id);
  if (!entry) return;
  entry.status = "failed";
  entry.errorMessage = errorMessage;
  notify(entry.recording.key);
}

export function deleteVoiceRecording(id: string): Promise<void> {
  const entry = entries.get(id);
  if (!entry) return Promise.resolve();
  entries.delete(id);
  entry.retryController?.abort();
  notify(entry.recording.key);
  if (!entry.persisted) return Promise.resolve();
  return enqueueDatabaseTask((store) => del([entry.recording.key, id], store));
}

export function deleteVoiceRecordingsForKey(key: string): void {
  for (const [id, entry] of entries) {
    if (entry.recording.key === key && entry.status !== "transcribing") {
      void deleteVoiceRecording(id);
    }
  }
}
