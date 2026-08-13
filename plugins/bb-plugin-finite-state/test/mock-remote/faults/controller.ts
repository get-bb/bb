import {
  normalizeScenarioSpec,
  type FaultService,
  type MockScenario,
  type ScenarioSpec,
} from "./scenarios.js";

export interface FaultLogEntry {
  scenario: string;
  service: string;
  requestId: string;
  routeId: string;
  attempt: number;
  effect: string;
}

export interface FaultController {
  install(spec: ScenarioSpec): void;
  clear(service?: ScenarioSpec["service"]): void;
  log(): readonly FaultLogEntry[];
}

export interface FaultSelection {
  readonly spec: ScenarioSpec & { routeIds: string[] };
  readonly requestId: string;
  readonly routeId: string;
  readonly attempt: number;
}

export interface FaultControllerRuntime extends FaultController {
  select(service: FaultService, routeId: string, request: Request): FaultSelection | null | "unknown";
  record(selection: FaultSelection, effect: string): void;
}

export const MOCK_SCENARIO_HEADER = "X-FS-Mock-Scenario";
export const MOCK_REQUEST_ID_HEADER = "X-Request-ID";

export function createFaultController(): FaultControllerRuntime {
  const installed = new Map<string, ScenarioSpec & { routeIds: string[] }>();
  const defaults = new Map<FaultService, MockScenario>();
  const attempts = new Map<string, number>();
  const entries: FaultLogEntry[] = [];
  let nextRequestId = 1;

  return {
    install(spec) {
      const normalized = normalizeScenarioSpec(spec);
      installed.set(`${normalized.service}:${normalized.name}`, normalized);
      defaults.set(normalized.service, normalized.name);
    },
    clear(service) {
      if (service === undefined) {
        installed.clear();
        defaults.clear();
        attempts.clear();
        entries.splice(0);
        nextRequestId = 1;
        return;
      }
      for (const [key, spec] of installed) {
        if (spec.service === service) installed.delete(key);
      }
      defaults.delete(service);
      for (const key of attempts.keys()) {
        if (key.startsWith(`${service}:`)) attempts.delete(key);
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        if (entries[index]?.service === service) entries.splice(index, 1);
      }
    },
    log() {
      return entries.map((entry) => ({ ...entry }));
    },
    select(service, routeId, request) {
      const requested = request.headers.get(MOCK_SCENARIO_HEADER);
      const name = requested ?? defaults.get(service);
      if (name === undefined) return null;
      const spec = installed.get(`${service}:${name as MockScenario}`);
      if (requested !== null && spec === undefined) {
        const belongsToOtherService = [...installed.values()].some(
          (candidate) => candidate.name === requested && candidate.service !== service,
        );
        return belongsToOtherService ? null : "unknown";
      }
      if (spec === undefined || spec.service !== service || !spec.routeIds.includes(routeId)) return null;
      const requestId = request.headers.get(MOCK_REQUEST_ID_HEADER) ?? `mock-request-${nextRequestId++}`;
      // Mid-push reset is one-shot per logical push. A retry reuses requestId
      // and converges; a distinct push id receives its own deterministic reset.
      const sequence = spec.name === "mid-push-reset" ? requestId : "service-sequence";
      const key = `${service}:${spec.name}:${routeId}:${sequence}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      return { spec, requestId, routeId, attempt };
    },
    record(selection, effect) {
      entries.push({
        scenario: selection.spec.name,
        service: selection.spec.service,
        requestId: selection.requestId,
        routeId: selection.routeId,
        attempt: selection.attempt,
        effect,
      });
    },
  };
}
