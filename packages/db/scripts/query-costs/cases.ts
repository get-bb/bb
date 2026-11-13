import type { QueryCostCase } from "./case.js";
import { EVENTS_COST_CASES } from "./events-cases.js";
import { QUEUED_THREAD_MESSAGES_COST_CASES } from "./queued-thread-messages-cases.js";

export const QUERY_COST_CASES: readonly QueryCostCase[] = [
  ...EVENTS_COST_CASES,
  ...QUEUED_THREAD_MESSAGES_COST_CASES,
];
