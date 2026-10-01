import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import {
  DEFAULT_THREAD_CREATION_PLACEMENT,
  readThreadCreationPlacement,
  type ThreadCreationPlacement,
} from "./thread-creation-placement";
import { atom, useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ForkThreadCreateSeed } from "@bb/client-core";
import { createTabScopedStorage } from "./browser-storage";

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string,
): string {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

const rootComposeProjectIdStorage = createTabScopedStorage<string>(
  {
    parse: parseStoredProjectId,
    serialize: (value) => value,
  },
  { persistInitialValue: true },
);

const rootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

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

const rootComposeForkSeedAtom = atom<ForkThreadCreateSeed | null>(null);

export function useRootComposeProjectId() {
  return useAtom(rootComposeProjectIdAtom);
}

export function useSetRootComposeProjectId() {
  return useSetAtom(rootComposeProjectIdAtom);
}

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtom);
}

export function useRootComposeForkSeed() {
  return useAtom(rootComposeForkSeedAtom);
}
