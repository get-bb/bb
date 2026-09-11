type NavigationOutcome = "ready" | "cancelled";

interface PendingNavigation {
  listener(outcome: NavigationOutcome): void;
  timer: ReturnType<typeof setTimeout> | null;
}

const pending = new Map<string, PendingNavigation>();

export function watchNotificationNavigation(
  id: string,
  listener: (outcome: NavigationOutcome) => void,
): () => void {
  const entry: PendingNavigation = { listener, timer: null };
  pending.set(id, entry);
  return () => {
    if (entry.timer !== null) clearTimeout(entry.timer);
    if (pending.get(id) === entry) pending.delete(id);
  };
}

export function setNotificationNavigationReady(id: string, ready: boolean): void {
  const entry = pending.get(id);
  if (!entry) return;
  if (!ready) {
    if (entry.timer !== null) clearTimeout(entry.timer);
    entry.timer = null;
  } else if (entry.timer === null) {
    entry.timer = setTimeout(() => finishNotificationNavigation(id, "ready"), 100);
  }
}

export function finishNotificationNavigation(
  id: string,
  outcome: NavigationOutcome,
): void {
  const entry = pending.get(id);
  if (!entry) return;
  if (entry.timer !== null) clearTimeout(entry.timer);
  pending.delete(id);
  entry.listener(outcome);
}
