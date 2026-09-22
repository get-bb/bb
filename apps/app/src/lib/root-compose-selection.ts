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

const rootComposeReuseEnvironmentAtom = atom<string | null>(null);

const rootComposeSectionIdAtom = atom<string | null>(null);

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

export function useRootComposeSectionId() {
  return useAtom(rootComposeSectionIdAtom);
}

export function useRootComposeForkSeed() {
  return useAtom(rootComposeForkSeedAtom);
}
