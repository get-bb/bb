// bb-fork(windows): fork-owned session memory. Upstream keeps the active thread
// bb-fork(windows): only in the URL and its in-memory route history, so a full
// bb-fork(windows): page reload (dev instance restarts, desktop shell reloads)
// bb-fork(windows): drops the user back on the new-thread screen.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useRouteState } from "@/hooks/useRouteState";
import { withLocalStorage } from "@/lib/browser-storage";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import {
  MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT,
  readCachedSidebarBootstrap,
} from "@/lib/sidebar-bootstrap-cache";

const FORK_LAST_THREAD_STORAGE_KEY = "bb.fork.lastThread";

export interface ForkLastThread {
  projectId: string;
  threadId: string;
}

function parseForkLastThread(text: string | null): ForkLastThread | null {
  if (text === null) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const { projectId, threadId } = raw as Record<string, unknown>;
  if (
    typeof projectId !== "string" ||
    projectId.length === 0 ||
    typeof threadId !== "string" ||
    threadId.length === 0
  ) {
    return null;
  }
  return { projectId, threadId };
}

export function readForkLastThread(): ForkLastThread | null {
  return parseForkLastThread(
    withLocalStorage(
      (storage) => storage.getItem(FORK_LAST_THREAD_STORAGE_KEY),
      null,
    ),
  );
}

export function writeForkLastThread(value: ForkLastThread): void {
  withLocalStorage((storage) => {
    storage.setItem(FORK_LAST_THREAD_STORAGE_KEY, JSON.stringify(value));
  }, undefined);
}

export function clearForkLastThread(): void {
  withLocalStorage((storage) => {
    storage.removeItem(FORK_LAST_THREAD_STORAGE_KEY);
  }, undefined);
}

function isKnownThread(value: ForkLastThread): boolean {
  const cached = readCachedSidebarBootstrap();
  if (cached === null) return true;
  const project =
    value.projectId === PERSONAL_PROJECT_ID
      ? cached.personalProject
      : cached.projects.find((project) => project.id === value.projectId);
  if (project === undefined) return false;
  if (project.threads.some((thread) => thread.id === value.threadId))
    return true;
  // The cached bootstrap is bounded per project, so a miss on a full page may
  // still exist on the server; keep it rather than silently forgetting.
  return project.threads.length >= MAX_CACHED_SIDEBAR_THREADS_PER_PROJECT;
}

export function ForkAppStateRestore() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId, threadId, isThreadView } = useRouteState();
  const restoreSettled = useRef(false);

  useEffect(() => {
    if (!isThreadView || projectId === undefined || threadId === undefined) {
      return;
    }
    writeForkLastThread({ projectId, threadId });
  }, [isThreadView, projectId, threadId]);

  useEffect(() => {
    if (restoreSettled.current) return;
    restoreSettled.current = true;
    if (location.pathname !== getRootComposeRoutePath()) return;
    const stored = readForkLastThread();
    if (stored === null) return;
    if (!isKnownThread(stored)) {
      clearForkLastThread();
      return;
    }
    void navigate(getThreadRoutePath(stored), { replace: true });
  }, [location.pathname, navigate]);

  return null;
}
