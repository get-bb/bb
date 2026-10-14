import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import {
  DEFAULT_THREAD_CREATION_PLACEMENT,
  readThreadCreationPlacement,
  type ThreadCreationPlacement,
} from "./thread-creation-placement";
import { useMemo } from "react";
import { atom, useAtom, useAtomValue, useSetAtom, useStore } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { createTabScopedStorage } from "./browser-storage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string | null,
): string | null {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

const rootComposeProjectIdStorage = createTabScopedStorage<string | null>(
  {
    parse: parseStoredProjectId,
    serialize: (value) => value ?? "",
  },
  { persistInitialValue: true },
);

const rootComposeStoredProjectIdAtom = atomWithStorage<string | null>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  null,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const rootComposeProjectChosenAtom = atom(false);
const rootComposeProjectIdAtom = atom(
  (get) => get(rootComposeStoredProjectIdAtom) ?? PERSONAL_PROJECT_ID,
  (_get, set, projectId: string) => {
    set(rootComposeProjectChosenAtom, true);
    set(rootComposeStoredProjectIdAtom, projectId);
  },
);

export function useImportedProjectDefault() {
  const store = useStore();
  useAtomValue(rootComposeStoredProjectIdAtom);
  return useMemo(() => {
    let lastDefault: string | null = null;
    return (projectId: string) => {
      if (
        store.get(rootComposeStoredProjectIdAtom) !== lastDefault ||
        store.get(rootComposeProjectChosenAtom)
      )
        return;
      store.set(rootComposeStoredProjectIdAtom, projectId);
      lastDefault = projectId;
    };
  }, [store]);
}

const rootComposeReuseEnvironmentAtom = atomWithStorage<string | null>(
  "bb.root-compose.reuse-environment",
  null,
  createTabScopedStorage<string | null>({
    parse: (storedValue) =>
      storedValue !== null &&
      parseEnvironmentValue(storedValue)?.type === "reuse"
        ? storedValue
        : null,
    serialize: (value) => value ?? "",
  }),
  { getOnInit: true },
);

const rootComposeStoredPlacementAtom = atomWithStorage<ThreadCreationPlacement>(
  "bb.root-compose.placement",
  DEFAULT_THREAD_CREATION_PLACEMENT,
  createTabScopedStorage<ThreadCreationPlacement>({
    parse: (storedValue, initialValue) => {
      if (storedValue === null) return initialValue;
      try {
        return (
          readThreadCreationPlacement({ placement: JSON.parse(storedValue) }) ??
          initialValue
        );
      } catch {
        return initialValue;
      }
    },
    serialize: JSON.stringify,
  }),
  { getOnInit: true },
);

const rootComposePlacementAtom = atom(
  (get) => get(rootComposeStoredPlacementAtom),
  (get, set, next: ThreadCreationPlacement) => {
    const current = get(rootComposeStoredPlacementAtom);
    if (current.sectionId === next.sectionId && current.pinned === next.pinned)
      return;
    set(rootComposeStoredPlacementAtom, next);
  },
);

export function useRootComposePlacement() {
  return useAtom(rootComposePlacementAtom);
}

export function useRootComposeProjectId() {
  return useAtom(rootComposeProjectIdAtom);
}

export function useSetRootComposeProjectId() {
  return useSetAtom(rootComposeProjectIdAtom);
}

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtom);
}
