import { isDeepStrictEqual } from "node:util";
import type {
  DynamicTool,
  InstructionMode,
  SessionOptionSelections,
} from "@bb/domain";
import {
  classifySessionSettingChange,
  type SessionSettingApply,
  type SessionSettingChange,
  type SessionSettingKey,
  type SessionSettingsApply,
  type SessionSettingsDeclaration,
} from "@bb/provider-bridge-protocol";
import { bridgeLaunchProcessKey } from "./bridge-launch-process-key.js";
import type {
  AgentRuntimeBridgeLaunch,
  AgentRuntimeExecutionOptions,
  AgentRuntimeSkillRoot,
} from "./types.js";

export interface SessionSettingsRecord {
  bridgeLaunch: AgentRuntimeBridgeLaunch;
  dynamicTools: DynamicTool[] | undefined;
  envVars: Record<string, string>;
  instructionMode: InstructionMode;
  instructions: string | undefined;
  options: AgentRuntimeExecutionOptions;
  skillRoots: readonly AgentRuntimeSkillRoot[];
}

export type PlannedSessionSettingChange =
  | { change: SessionSettingChange; apply: SessionSettingApply }
  | { change: { setting: "bridgeBuild"; value: null }; apply: "resume" };

export interface SessionSettingsPlan {
  live: PlannedSessionSettingChange[];
  resume: PlannedSessionSettingChange[];
  fresh: PlannedSessionSettingChange[];
}

type ProviderOptions = NonNullable<
  AgentRuntimeExecutionOptions["providerOptions"]
>;

function valueKey(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function permissionChanged(
  applied: AgentRuntimeExecutionOptions,
  desired: AgentRuntimeExecutionOptions,
): boolean {
  return (
    applied.permissionMode !== desired.permissionMode ||
    applied.permissionScope !== desired.permissionScope ||
    applied.approvalReviewer !== desired.approvalReviewer ||
    applied.permissionEscalation !== desired.permissionEscalation
  );
}

function changedProviderOptionKeys(
  applied: ProviderOptions | undefined,
  desired: ProviderOptions | undefined,
): string[] {
  const keys = new Set([
    ...Object.keys(applied ?? {}),
    ...Object.keys(desired ?? {}),
  ]);
  return [...keys].filter(
    (key) => !isDeepStrictEqual(applied?.[key], desired?.[key]),
  );
}

function changedSessionOptionKeys(
  applied: SessionOptionSelections | undefined,
  desired: SessionOptionSelections | undefined,
): string[] {
  if (desired === undefined) {
    return [];
  }
  return Object.keys(desired).filter((key) => applied?.[key] !== desired[key]);
}

export function listUserSettingChanges(
  applied: AgentRuntimeExecutionOptions,
  desired: AgentRuntimeExecutionOptions,
): SessionSettingChange[] {
  const changes: SessionSettingChange[] = [];
  for (const setting of ["model", "reasoningLevel", "serviceTier"] as const) {
    if (applied[setting] !== desired[setting]) {
      changes.push({ setting, value: valueKey(desired[setting]) });
    }
  }
  if (permissionChanged(applied, desired)) {
    changes.push({ setting: "permission", value: desired.permissionMode });
  }
  for (const option of changedSessionOptionKeys(
    applied.sessionOptions,
    desired.sessionOptions,
  )) {
    changes.push({
      setting: "sessionOptions",
      option,
      value: valueKey(desired.sessionOptions?.[option]),
    });
  }
  for (const option of changedProviderOptionKeys(
    applied.providerOptions,
    desired.providerOptions,
  )) {
    changes.push({
      setting: "providerOptions",
      option,
      value: valueKey(desired.providerOptions?.[option]),
    });
  }
  return changes;
}

function listSessionSettingChanges(
  applied: SessionSettingsRecord,
  desired: SessionSettingsRecord,
): SessionSettingChange[] {
  const changes = listUserSettingChanges(applied.options, desired.options);
  const pendingSelections = desired.options.sessionOptions ?? {};
  for (const option of Object.keys(pendingSelections)) {
    if (
      !changes.some(
        (change) =>
          change.setting === "sessionOptions" && change.option === option,
      )
    ) {
      changes.push({
        setting: "sessionOptions",
        option,
        value: valueKey(pendingSelections[option]),
      });
    }
  }
  if (!isDeepStrictEqual(applied.envVars, desired.envVars)) {
    changes.push({ setting: "env", value: null });
  }
  if (
    applied.instructions !== desired.instructions ||
    applied.instructionMode !== desired.instructionMode
  ) {
    changes.push({ setting: "instructions", value: null });
  }
  if (!isDeepStrictEqual(applied.dynamicTools ?? [], desired.dynamicTools ?? [])) {
    changes.push({ setting: "dynamicTools", value: null });
  }
  if (!isDeepStrictEqual(applied.skillRoots, desired.skillRoots)) {
    changes.push({ setting: "skills", value: null });
  }
  return changes;
}

export function planSessionSettings(args: {
  applied: SessionSettingsRecord;
  declaration: SessionSettingsDeclaration;
  desired: SessionSettingsRecord;
  sessionRestorable: boolean;
}): SessionSettingsPlan {
  const plan: SessionSettingsPlan = { live: [], resume: [], fresh: [] };
  for (const change of listSessionSettingChanges(args.applied, args.desired)) {
    const declared = classifySessionSettingChange(args.declaration, change);
    const apply =
      declared === "resume" && !args.sessionRestorable ? "fresh" : declared;
    plan[apply].push({ change, apply });
  }
  if (
    bridgeLaunchProcessKey(args.applied.bridgeLaunch) !==
    bridgeLaunchProcessKey(args.desired.bridgeLaunch)
  ) {
    const buildChange: PlannedSessionSettingChange = {
      change: { setting: "bridgeBuild", value: null },
      apply: "resume",
    };
    if (args.sessionRestorable) {
      plan.resume.push(buildChange);
    }
  }
  return plan;
}

function includes(
  changes: readonly PlannedSessionSettingChange[],
  predicate: (change: PlannedSessionSettingChange["change"]) => boolean,
): boolean {
  return changes.some((planned) => predicate(planned.change));
}

function hasSetting(
  changes: readonly PlannedSessionSettingChange[],
  setting: SessionSettingKey | "bridgeBuild",
): boolean {
  return includes(changes, (change) => change.setting === setting);
}

function optionKeys(
  changes: readonly PlannedSessionSettingChange[],
  setting: "sessionOptions" | "providerOptions",
): string[] {
  return changes.flatMap((planned) =>
    planned.change.setting === setting ? [planned.change.option] : [],
  );
}

export function composeSessionSettingsRecord(args: {
  applied: SessionSettingsRecord;
  desired: SessionSettingsRecord;
  taken: readonly PlannedSessionSettingChange[];
}): SessionSettingsRecord {
  const { applied, desired, taken } = args;
  const pick = <T>(setting: SessionSettingKey, from: T, to: T): T =>
    hasSetting(taken, setting) ? to : from;
  const takenProviderOptions = optionKeys(taken, "providerOptions");
  const providerOptions: ProviderOptions = { ...applied.options.providerOptions };
  for (const key of takenProviderOptions) {
    const value = desired.options.providerOptions?.[key];
    if (value === undefined) {
      delete providerOptions[key];
    } else {
      providerOptions[key] = value;
    }
  }
  const takenSessionOptions = optionKeys(taken, "sessionOptions");
  const sessionOptions: SessionOptionSelections = {};
  for (const key of takenSessionOptions) {
    const value = desired.options.sessionOptions?.[key];
    if (value !== undefined) {
      sessionOptions[key] = value;
    }
  }
  const permissionSource = hasSetting(taken, "permission")
    ? desired.options
    : applied.options;
  const options = {
    ...desired.options,
    model: pick("model", applied.options.model, desired.options.model),
    reasoningLevel: pick(
      "reasoningLevel",
      applied.options.reasoningLevel,
      desired.options.reasoningLevel,
    ),
    serviceTier: pick(
      "serviceTier",
      applied.options.serviceTier,
      desired.options.serviceTier,
    ),
    permissionMode: permissionSource.permissionMode,
    permissionScope: permissionSource.permissionScope,
    approvalReviewer: permissionSource.approvalReviewer,
    permissionEscalation: permissionSource.permissionEscalation,
    sessionOptions,
    providerOptions,
  } as AgentRuntimeExecutionOptions;
  return {
    bridgeLaunch: hasSetting(taken, "bridgeBuild")
      ? desired.bridgeLaunch
      : applied.bridgeLaunch,
    dynamicTools: pick(
      "dynamicTools",
      applied.dynamicTools,
      desired.dynamicTools,
    ),
    envVars: pick("env", applied.envVars, desired.envVars),
    instructionMode: pick(
      "instructions",
      applied.instructionMode,
      desired.instructionMode,
    ),
    instructions: pick(
      "instructions",
      applied.instructions,
      desired.instructions,
    ),
    options,
    skillRoots: pick("skills", applied.skillRoots, desired.skillRoots),
  };
}

export function toSessionSettingsApply(
  live: readonly PlannedSessionSettingChange[],
): SessionSettingsApply {
  const settings = new Set<SessionSettingKey>();
  for (const planned of live) {
    const { setting } = planned.change;
    if (
      setting !== "sessionOptions" &&
      setting !== "providerOptions" &&
      setting !== "bridgeBuild"
    ) {
      settings.add(setting);
    }
  }
  return {
    settings: [...settings],
    sessionOptions: optionKeys(live, "sessionOptions"),
    providerOptions: optionKeys(live, "providerOptions"),
  };
}

const SETTING_LABELS: Record<SessionSettingKey | "bridgeBuild", string> = {
  model: "model",
  reasoningLevel: "reasoning level",
  serviceTier: "service tier",
  permission: "permissions",
  env: "environment",
  instructions: "instructions",
  dynamicTools: "plugin tools",
  skills: "skills",
  bridgeBuild: "provider plugin build",
};

export function describeSessionSettingChanges(
  changes: readonly PlannedSessionSettingChange[],
): string {
  const labels = new Set<string>();
  for (const planned of changes) {
    const { change } = planned;
    if (change.setting === "sessionOptions") {
      labels.add(`session option "${change.option}"`);
    } else if (change.setting === "providerOptions") {
      labels.add(`provider option "${change.option}"`);
    } else {
      labels.add(SETTING_LABELS[change.setting]);
    }
  }
  return [...labels].join(", ");
}
