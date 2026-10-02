import {
  createConnection,
  migrate,
  upsertHost,
  createProject,
  createEnvironment,
  createThread,
  noopNotifier,
  environments,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { NotificationHub } from "../src/ws/hub.ts";
import { WatchInterestCoordinator } from "../src/ws/watch-interests.ts";
const count = Number(process.argv[2] ?? 20);
const hostCount = Number(process.argv[3] ?? 2);
const rounds = Number(process.argv[4] ?? 50);
if (
  ![count, hostCount, rounds].every((n) => Number.isInteger(n) && n > 0) ||
  count > 1000 ||
  hostCount > 10
)
  throw new Error(
    "Usage: watch-interest-benchmark.mjs <threads:1..1000> <hosts:1..10> <rounds>",
  );
const directory = await mkdtemp(join(tmpdir(), "bb-watch-benchmark-"));
const db = createConnection(join(directory, "core.db"));
migrate(db);
const hub = new NotificationHub();
const coordinator = new WatchInterestCoordinator({ db, hub });
const hosts = [];
const threads = [];
let messages = 0;
const socket = {
  close() {},
  send() {
    messages++;
  },
};
try {
  db.transaction(() => {
    for (let i = 0; i < hostCount; i++) {
      const host = upsertHost(db, noopNotifier, { name: `host-${i}` });
      const project = createProject(db, noopNotifier, {
        name: `project-${i}`,
        source: { type: "local_path", hostId: host.id, path: directory },
      }).project;
      const environment = createEnvironment(db, noopNotifier, {
        providerOwnsPath: false,
        projectId: project.id,
        hostId: host.id,
        path: join(directory, `workspace-${i}`),
        status: "ready",
      });
      hosts.push({ host, project, environment });
    }
    for (let i = 0; i < count; i++) {
      const { project, environment } = hosts[i % hostCount];
      threads.push(
        createThread(db, noopNotifier, {
          projectId: project.id,
          environmentId: environment.id,
          providerId: "benchmark",
        }),
      );
    }
  });
  for (const { host, environment } of hosts) {
    hub.registerDaemon(host.id, host.id, socket);
    coordinator.subscribe(socket, {
      kind: "environment-detail",
      environmentId: environment.id,
    });
  }
  for (const thread of threads)
    coordinator.subscribe(socket, {
      kind: "thread-detail",
      threadId: thread.id,
    });
  let recording = false;
  let queries = 0;
  const prepare = db.$client.prepare.bind(db.$client);
  db.$client.prepare = (sql) => {
    const statement = prepare(sql);
    for (const method of ["get", "all"]) {
      const call = statement[method].bind(statement);
      statement[method] = (...args) => {
        if (recording) queries++;
        return call(...args);
      };
    }
    return statement;
  };
  const durations = [];
  const callbackDelays = [];
  const queryCounts = [];
  const messageCounts = [];
  for (let i = -3; i < rounds; i++) {
    const { environment } = hosts[0];
    db.update(environments)
      .set({ path: join(directory, `workspace-changed-${i}`) })
      .where(eq(environments.id, environment.id))
      .run();
    queries = 0;
    messages = 0;
    const start = performance.now();
    const foreground = new Promise((resolve) =>
      setTimeout(() => resolve(performance.now() - start), 0),
    );
    recording = true;
    hub.notifyEnvironment(environment.id, ["metadata-changed"]);
    const elapsed = performance.now() - start;
    recording = false;
    const callbackDelay = await foreground;
    if (i >= 0) {
      durations.push(elapsed);
      callbackDelays.push(callbackDelay);
      queryCounts.push(queries);
      messageCounts.push(messages);
    }
  }
  const resolvedThreadTargets = hosts.reduce(
    (n, { host }) =>
      n +
      coordinator.reconcileWatchSetForHost(host.id).threadStorageTargets.length,
    0,
  );
  if (resolvedThreadTargets !== count || messageCounts.some((n) => n !== 1))
    throw new Error("Watch-set output changed");
  const stats = (values) => {
    values.sort((a, b) => a - b);
    return {
      n: values.length,
      p50: values[Math.floor(values.length * 0.5)],
      p95: values[Math.floor(values.length * 0.95)],
      p99: values[Math.floor(values.length * 0.99)],
      max: values.at(-1),
    };
  };
  console.log(
    JSON.stringify(
      {
        threads: count,
        hosts: hostCount,
        rounds,
        warmups: 3,
        resolvedThreadTargets,
        refreshMs: stats(durations),
        queuedCallbackMs: stats(callbackDelays),
        queries: stats(queryCounts),
        messages: stats(messageCounts),
      },
      null,
      2,
    ),
  );
} finally {
  db.$client.close();
  await rm(directory, { recursive: true, force: true });
}
