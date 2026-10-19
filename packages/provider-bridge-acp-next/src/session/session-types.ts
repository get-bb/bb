export type AcpJsonObject = Record<string, unknown>;

export type AcpWorkState = "idle" | "running" | "requires_action";

export type AcpWorkInitiator = "client" | "agent";

export interface AcpWorkError {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpSessionWork {
  state: AcpWorkState;
  initiator: AcpWorkInitiator | null;
  stopReason: string | null;
  error: AcpWorkError | null;
}

export interface AcpContentBlock extends AcpJsonObject {
  type: string;
}

export type AcpMessageRole = "user" | "agent" | "thought";

export interface AcpMessageEntity {
  messageId: string;
  role: AcpMessageRole;
  content: AcpContentBlock[];
  idSource: "agent" | "synthesized";
}

export interface AcpToolCallLocation {
  path: string;
  line?: number;
}

export interface AcpToolCallContentItem extends AcpJsonObject {
  type: string;
}

export interface AcpToolCallEntity {
  toolCallId: string;
  title: string;
  name?: string;
  kind?: string;
  status: string;
  content: AcpToolCallContentItem[];
  locations: AcpToolCallLocation[];
  rawInput?: unknown;
  rawOutput?: unknown;
  meta?: AcpJsonObject;
}

export type AcpToolCallField =
  | "title"
  | "name"
  | "kind"
  | "status"
  | "content"
  | "locations"
  | "rawInput"
  | "rawOutput"
  | "meta";

export interface AcpPlanEntry {
  content: string;
  priority: string;
  status: string;
  meta?: AcpJsonObject;
}

export interface AcpPlanEntity {
  planId: string;
  entries: AcpPlanEntry[];
}

export interface AcpConfigOptionValue {
  value: string;
  name: string;
  description?: string;
}

export interface AcpConfigOptionGroup {
  group: string;
  name: string;
  options: AcpConfigOptionValue[];
}

export type AcpConfigOptionSetMethod =
  | "session/set_config_option"
  | "session/set_mode"
  | "session/set_model";

interface AcpConfigOptionBase {
  id: string;
  name: string;
  description?: string;
  category?: string;
  setMethod: AcpConfigOptionSetMethod;
}

export interface AcpSelectConfigOption extends AcpConfigOptionBase {
  type: "select";
  currentValue: string;
  values: AcpConfigOptionValue[];
  groups: AcpConfigOptionGroup[];
}

export interface AcpBooleanConfigOption extends AcpConfigOptionBase {
  type: "boolean";
  currentValue: boolean;
}

export interface AcpUnsupportedConfigOption extends AcpConfigOptionBase {
  type: "unsupported";
  rawType: string;
  raw: AcpJsonObject;
}

export type AcpConfigOption =
  | AcpSelectConfigOption
  | AcpBooleanConfigOption
  | AcpUnsupportedConfigOption;

export interface AcpAvailableCommand {
  name: string;
  description: string;
  inputHint?: string;
}

export interface AcpSessionInfo {
  title: string | null;
  updatedAt: string | null;
}

export interface AcpUsageCost {
  amount: number;
  currency: string;
}

export interface AcpSessionUsage {
  used: number;
  size: number;
  cost: AcpUsageCost | null;
}

export interface AcpSessionSnapshot {
  work: AcpSessionWork;
  messages: readonly AcpMessageEntity[];
  toolCalls: readonly AcpToolCallEntity[];
  plans: readonly AcpPlanEntity[];
  configOptions: readonly AcpConfigOption[];
  commands: readonly AcpAvailableCommand[];
  info: AcpSessionInfo;
  usage: AcpSessionUsage | null;
}

interface AcpSessionEventBase {
  replay: boolean;
}

export interface AcpWorkEvent extends AcpSessionEventBase {
  type: "work";
  previous: AcpSessionWork;
  work: AcpSessionWork;
}

export interface AcpMessageAppendedEvent extends AcpSessionEventBase {
  type: "message";
  change: "appended";
  messageId: string;
  role: AcpMessageRole;
  idSource: AcpMessageEntity["idSource"];
  appended: readonly AcpContentBlock[];
}

export interface AcpMessageReplacedEvent extends AcpSessionEventBase {
  type: "message";
  change: "replaced";
  messageId: string;
  role: AcpMessageRole;
  idSource: AcpMessageEntity["idSource"];
  content: readonly AcpContentBlock[];
}

export type AcpMessageEvent = AcpMessageAppendedEvent | AcpMessageReplacedEvent;

export interface AcpToolCallEvent extends AcpSessionEventBase {
  type: "toolCall";
  created: boolean;
  updated: AcpToolCallField[];
  toolCall: AcpToolCallEntity;
}

export interface AcpPlanEvent extends AcpSessionEventBase {
  type: "plan";
  plan: AcpPlanEntity;
}

export interface AcpConfigOptionsEvent extends AcpSessionEventBase {
  type: "configOptions";
  configOptions: readonly AcpConfigOption[];
}

export interface AcpCommandsEvent extends AcpSessionEventBase {
  type: "commands";
  commands: readonly AcpAvailableCommand[];
}

export interface AcpInfoEvent extends AcpSessionEventBase {
  type: "info";
  info: AcpSessionInfo;
}

export interface AcpUsageEvent extends AcpSessionEventBase {
  type: "usage";
  usage: AcpSessionUsage;
}

export interface AcpUnhandledUpdateEvent extends AcpSessionEventBase {
  type: "unhandled";
  reason: "unknown-variant" | "malformed";
  sessionUpdate: string | null;
  raw: unknown;
}

export type AcpSessionEvent =
  | AcpWorkEvent
  | AcpMessageEvent
  | AcpToolCallEvent
  | AcpPlanEvent
  | AcpConfigOptionsEvent
  | AcpCommandsEvent
  | AcpInfoEvent
  | AcpUsageEvent
  | AcpUnhandledUpdateEvent;
