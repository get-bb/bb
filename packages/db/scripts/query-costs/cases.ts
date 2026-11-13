import { registerCostGroup, type RegisteredCostGroup } from "./case.js";
import { EVENTS_COST_CASES } from "./events-cases.js";
import { HOSTS_ENVIRONMENTS_COST_GROUP } from "./hosts-environments-cases.js";
import { PLUGINS_COST_GROUP } from "./plugins-cases.js";
import { QUEUED_THREAD_MESSAGES_COST_CASES } from "./queued-thread-messages-cases.js";
import { SETTINGS_MAINTENANCE_COST_GROUP } from "./settings-maintenance-cases.js";
import { THREADS_COST_GROUP } from "./threads-cases.js";

const ALL_GROUPS: readonly RegisteredCostGroup[] = [
  registerCostGroup({
    name: "events",
    seed: () => undefined,
    cases: EVENTS_COST_CASES,
  }),
  registerCostGroup({
    name: "queued-thread-messages",
    seed: () => undefined,
    cases: QUEUED_THREAD_MESSAGES_COST_CASES,
  }),
  THREADS_COST_GROUP,
  HOSTS_ENVIRONMENTS_COST_GROUP,
  PLUGINS_COST_GROUP,
  SETTINGS_MAINTENANCE_COST_GROUP,
];

function selectedGroupNames(): ReadonlySet<string> | null {
  const index = process.argv.indexOf("--group");
  if (index < 0) return null;
  const names = process.argv[index + 1];
  if (names === undefined) throw new Error("--group needs a group name list");
  return new Set(names.split(","));
}

const selected = selectedGroupNames();

export const QUERY_COST_GROUPS: readonly RegisteredCostGroup[] =
  selected === null
    ? ALL_GROUPS
    : ALL_GROUPS.filter((group) => selected.has(group.name));

export const QUERY_COST_CASES = QUERY_COST_GROUPS.flatMap(
  (group) => group.cases,
);

export const PARTIAL_RUN = selected !== null;
