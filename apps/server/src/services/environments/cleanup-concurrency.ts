interface PendingCleanup {
  hostId: string | null;
  run(): Promise<void>;
  resolve(): void;
  reject(error: unknown): void;
}

interface CleanupQueue {
  active: number;
  hosts: Set<string | null>;
  pending: PendingCleanup[];
}

const queues = new WeakMap<object, CleanupQueue>();
const MAX_ACTIVE_CLEANUPS = 4;

function drain(queue: CleanupQueue): void {
  while (queue.active < MAX_ACTIVE_CLEANUPS) {
    const index = queue.pending.findIndex(
      (task) => !queue.hosts.has(task.hostId),
    );
    if (index < 0) return;
    const task = queue.pending.splice(index, 1)[0];
    if (task === undefined) return;
    queue.active += 1;
    queue.hosts.add(task.hostId);
    void Promise.resolve()
      .then(task.run)
      .then(task.resolve, task.reject)
      .finally(() => {
        queue.active -= 1;
        queue.hosts.delete(task.hostId);
        drain(queue);
      });
  }
}

export function withEnvironmentCleanupSlot(
  db: object,
  hostId: string | null,
  run: () => Promise<void>,
): Promise<void> {
  let queue = queues.get(db);
  if (queue === undefined) {
    queue = { active: 0, hosts: new Set(), pending: [] };
    queues.set(db, queue);
  }
  return new Promise<void>((resolve, reject) => {
    queue.pending.push({ hostId, run, resolve, reject });
    drain(queue);
  });
}
