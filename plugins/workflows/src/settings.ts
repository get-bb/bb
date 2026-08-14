import type {
  BbPluginApi,
  PluginSettingDescriptors,
  PluginSettingsValues,
} from "@get-bb/plugin-sdk";

export const WORKFLOW_SETTING_DESCRIPTORS = {
  maxActiveRuns: {
    type: "string",
    label: "Maximum active runs",
    description: "Concurrent workflow runs across the plugin (1-32).",
    default: "4",
  },
  maxConcurrentAgents: {
    type: "string",
    label: "Per-run agent concurrency",
    description: "Agent calls that one workflow may run concurrently (1-64).",
    default: "8",
  },
  maxAgentCalls: {
    type: "string",
    label: "Maximum agent calls",
    description: "Agent calls allowed during one workflow run (1-1000).",
    default: "100",
  },
  totalRunTimeoutMs: {
    type: "string",
    label: "Total run timeout (milliseconds)",
    description:
      "Fail a workflow after this total duration in milliseconds (60000-604800000).",
    default: "86400000",
  },
  retentionDays: {
    type: "string",
    label: "Retention (days)",
    description: "Days to retain completed workflow data (1-3650).",
    default: "30",
  },
  maxNotificationBytes: {
    type: "string",
    label: "Maximum notification bytes",
    description:
      "Maximum UTF-8 size of a completion notification (1024-262144).",
    default: "16384",
  },
} as const satisfies PluginSettingDescriptors;

type RawWorkflowSettings = PluginSettingsValues<
  typeof WORKFLOW_SETTING_DESCRIPTORS
>;

/** Validated policy values used by the workflow service and runtime. */
export interface WorkflowSettings {
  maxActiveRuns: number;
  maxConcurrentAgents: number;
  maxAgentCalls: number;
  totalRunTimeoutMs: number;
  retentionDays: number;
  maxNotificationBytes: number;
}

export const DEFAULT_WORKFLOW_SETTINGS: Readonly<WorkflowSettings> =
  Object.freeze({
    maxActiveRuns: 4,
    maxConcurrentAgents: 8,
    maxAgentCalls: 100,
    totalRunTimeoutMs: 24 * 60 * 60 * 1_000,
    retentionDays: 30,
    maxNotificationBytes: 16 * 1_024,
  });

interface IntegerField {
  label: string;
  minimum: number;
  maximum: number;
}

const INTEGER_FIELDS: Readonly<Record<keyof WorkflowSettings, IntegerField>> =
  Object.freeze({
    maxActiveRuns: {
      label: "Maximum active runs",
      minimum: 1,
      maximum: 32,
    },
    maxConcurrentAgents: {
      label: "Per-run agent concurrency",
      minimum: 1,
      maximum: 64,
    },
    maxAgentCalls: {
      label: "Maximum agent calls",
      minimum: 1,
      maximum: 1_000,
    },
    totalRunTimeoutMs: {
      label: "Total run timeout",
      minimum: 60_000,
      maximum: 604_800_000,
    },
    retentionDays: {
      label: "Retention days",
      minimum: 1,
      maximum: 3_650,
    },
    maxNotificationBytes: {
      label: "Maximum notification bytes",
      minimum: 1_024,
      maximum: 262_144,
    },
  });

function parseBoundedInteger(raw: string, field: IntegerField): number {
  const value = raw.trim();
  const expectation = `${field.minimum} through ${field.maximum}`;
  if (value.length === 0) {
    throw new Error(
      `${field.label} cannot be empty; enter a base-10 integer from ${expectation}`,
    );
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(
      `${field.label} must be a base-10 integer from ${expectation}; received ${JSON.stringify(raw)}`,
    );
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isSafeInteger(parsed)) {
    throw new Error(
      `${field.label} must be a finite base-10 integer from ${expectation}; received ${JSON.stringify(raw)}`,
    );
  }
  if (parsed < field.minimum || parsed > field.maximum) {
    throw new Error(
      `${field.label} must be from ${expectation}; received ${parsed}`,
    );
  }
  return parsed;
}

/** Parse the host's string settings once, at the plugin/service boundary. */
export function parseWorkflowSettings(
  values: Readonly<RawWorkflowSettings>,
): WorkflowSettings {
  return Object.freeze({
    maxActiveRuns: parseBoundedInteger(
      values.maxActiveRuns,
      INTEGER_FIELDS.maxActiveRuns,
    ),
    maxConcurrentAgents: parseBoundedInteger(
      values.maxConcurrentAgents,
      INTEGER_FIELDS.maxConcurrentAgents,
    ),
    maxAgentCalls: parseBoundedInteger(
      values.maxAgentCalls,
      INTEGER_FIELDS.maxAgentCalls,
    ),
    totalRunTimeoutMs: parseBoundedInteger(
      values.totalRunTimeoutMs,
      INTEGER_FIELDS.totalRunTimeoutMs,
    ),
    retentionDays: parseBoundedInteger(
      values.retentionDays,
      INTEGER_FIELDS.retentionDays,
    ),
    maxNotificationBytes: parseBoundedInteger(
      values.maxNotificationBytes,
      INTEGER_FIELDS.maxNotificationBytes,
    ),
  });
}

const LEGACY_STORED_SETTING_KEYS = new Set(["workerStallTimeoutMs"]);

/** Parse a persisted run snapshot, tolerating only known removed fields. */
export function parseStoredWorkflowSettings(value: unknown): WorkflowSettings {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Workflow settings snapshot must be an object");
  }
  const object = value as Record<string, unknown>;
  const expected = Object.keys(INTEGER_FIELDS);
  const actual = Object.keys(object);
  if (
    expected.some((key) => !Object.hasOwn(object, key)) ||
    actual.some(
      (key) =>
        !Object.hasOwn(INTEGER_FIELDS, key) &&
        !LEGACY_STORED_SETTING_KEYS.has(key),
    )
  ) {
    throw new Error("Workflow settings snapshot has unexpected fields");
  }
  const raw = Object.fromEntries(
    expected.map((key) => {
      const stored = object[key];
      if (typeof stored !== "number" || !Number.isSafeInteger(stored)) {
        throw new Error(`Workflow settings snapshot.${key} must be an integer`);
      }
      return [key, String(stored)];
    }),
  ) as Record<keyof WorkflowSettings, string>;
  return parseWorkflowSettings(raw);
}

export interface WorkflowSettingsHandle {
  get(): Promise<WorkflowSettings>;
  onChange(
    listener: (next: WorkflowSettings, previous: WorkflowSettings) => void,
    onInvalid?: (error: Error) => void,
  ): void;
}

/** Register the descriptors and expose only parsed settings to consumers. */
export function registerWorkflowSettings(
  bb: Pick<BbPluginApi, "settings">,
): WorkflowSettingsHandle {
  const handle = bb.settings.define(WORKFLOW_SETTING_DESCRIPTORS);
  let lastValid = DEFAULT_WORKFLOW_SETTINGS;
  return {
    async get() {
      const parsed = parseWorkflowSettings(await handle.get());
      lastValid = parsed;
      return parsed;
    },
    onChange(listener, onInvalid) {
      handle.onChange((next, previous) => {
        try {
          const parsedNext = parseWorkflowSettings(next);
          let parsedPrevious = lastValid;
          try {
            parsedPrevious = parseWorkflowSettings(previous);
          } catch {
            // A valid save must recover even when it replaces corrupt state.
          }
          lastValid = parsedNext;
          listener(parsedNext, parsedPrevious);
        } catch (error) {
          onInvalid?.(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      });
    },
  };
}
