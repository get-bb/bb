import type { useStore } from "jotai";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { selectRootComposeProject } from "@/lib/root-compose-selection";
import type { InitialPromptSeed } from "@/components/promptbox/mentions/initial-prompt-draft";
import type { ThreadCreationPlacement } from "@/lib/thread-creation-placement";
import { splitLayoutAtom } from "./atoms";
import { placePaneContentInSplit } from "./openPaneContentInSplit";

export interface NewThreadOptions {
  projectId?: string;
  initialPrompt?: InitialPromptSeed;
  replaceInitialPrompt?: boolean;
  focusPrompt?: boolean;
  placement?: ThreadCreationPlacement;
  environmentId?: string;
  hostId?: string;
  split?: boolean;
  replace?: boolean;
}

export interface OpenNewThreadArgs extends NewThreadOptions {
  navigate: (
    route: string,
    options?: { replace?: boolean; state?: Record<string, unknown> },
  ) => void | Promise<void>;
  store: ReturnType<typeof useStore>;
  isCompact: boolean;
}

const NEW_THREAD_CONTENT = { kind: "new-thread" } as const;

function newThreadRouteState(
  options: NewThreadOptions,
): Record<string, unknown> {
  const hostId = options.hostId?.trim() ?? "";
  return {
    ...(options.focusPrompt === true ? { focusPrompt: true } : {}),
    ...(options.initialPrompt !== undefined && options.initialPrompt !== ""
      ? { initialPrompt: options.initialPrompt }
      : {}),
    ...(options.replaceInitialPrompt === true
      ? { replaceInitialPrompt: true }
      : {}),
    ...(options.placement !== undefined
      ? { placement: options.placement }
      : {}),
    ...(options.environmentId !== undefined
      ? { reuseEnvironmentId: options.environmentId }
      : {}),
    ...(hostId.length > 0 ? { newEnvironmentHostId: hostId } : {}),
  };
}

export function openNewThread({
  navigate,
  store,
  isCompact,
  ...options
}: OpenNewThreadArgs): void {
  if (options.projectId !== undefined) {
    selectRootComposeProject(store, options.projectId);
  }
  let alreadyOpen = false;
  const layout =
    options.split === true && !isCompact ? store.get(splitLayoutAtom) : null;
  if (layout !== null) {
    const placed = placePaneContentInSplit(layout, NEW_THREAD_CONTENT);
    if (placed.layout !== layout) store.set(splitLayoutAtom, placed.layout);
    alreadyOpen = placed.alreadyOpen;
  }
  const state = newThreadRouteState(options);
  void navigate(getRootComposeRoutePath(), {
    ...(options.replace === true || alreadyOpen ? { replace: true } : {}),
    ...(Object.keys(state).length > 0 ? { state } : {}),
  });
}
