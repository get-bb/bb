import {
  USER_QUESTION_MAX_FREE_TEXT_LENGTH,
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  userQuestionPendingInteractionPayloadSchema,
  type PendingInteractionUserAnswer,
  type PendingInteractionUserQuestionQuestion,
  type UserQuestionPendingInteractionPayload,
  type UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import {
  getStringProperty,
  isRecord,
  type StringRecord,
} from "./provider-visibility-helpers.js";

export type McpElicitationContent = Record<
  string,
  string | number | boolean | string[]
>;

export type McpElicitationResponse =
  | { action: "accept"; content: McpElicitationContent }
  | { action: "decline" }
  | { action: "cancel" };

export interface McpElicitationUnmappable {
  unmappable: string;
}

export type McpElicitationRequester =
  | { kind: "agent"; descriptionIsHeading: boolean }
  | { kind: "mcp_server"; serverName: string };

export interface McpElicitationQuestions {
  kind: "questions";
  payload: UserQuestionPendingInteractionPayload;
  toResponse(
    resolution: UserQuestionPendingInteractionResolution,
  ): McpElicitationStep;
}

export type McpElicitationStep =
  | McpElicitationResponse
  | McpElicitationUnmappable
  | { next: McpElicitationQuestions };

export type McpElicitationPlan =
  | McpElicitationQuestions
  | { kind: "unsupported"; reason: string };

interface McpElicitationChoice {
  value: string;
  label: string;
  description?: string;
}

interface Bounds {
  min: number | null;
  max: number | null;
}

const TEXT_FORMAT_HINTS = {
  email: "Enter an email address.",
  uri: "Enter a URL.",
  date: "Enter a date as YYYY-MM-DD.",
  "date-time":
    "Enter a date and time with a time zone, for example 2026-01-31T09:30:00Z.",
} as const;

const JSON_NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

type TextFormat = keyof typeof TEXT_FORMAT_HINTS;

type McpElicitationField =
  | { kind: "choice"; choices: McpElicitationChoice[] }
  | { kind: "typedChoice"; choices: McpElicitationChoice[] }
  | { kind: "multiChoice"; choices: McpElicitationChoice[]; items: Bounds }
  | { kind: "boolean" }
  | { kind: "text"; length: Bounds; format: TextFormat | null }
  | { kind: "number"; integer: boolean; range: Bounds };

interface FormField {
  name: string;
  schema: StringRecord;
  field: McpElicitationField;
  required: boolean;
}

interface OtherCompanion {
  name: string;
  choice: string | null;
}

interface PlannedField {
  name: string;
  label: string;
  field: McpElicitationField;
  required: boolean;
  other: OtherCompanion | null;
  question: PendingInteractionUserQuestionQuestion;
}

const CONFIRM_QUESTION_ID = "confirm";
const CONFIRM_ACCEPT_VALUE = "accept";
const CONFIRM_DECLINE_VALUE = "decline";
const GATE_ANSWER_VALUE = "answer";

const OTHER_COMPANION_SUFFIXES = ["__other", "_other"] as const;
const OTHER_CHOICE_VALUE = "other";

function readChoices(schema: StringRecord): McpElicitationChoice[] | null {
  const titled = schema["oneOf"] ?? schema["anyOf"];
  if (Array.isArray(titled)) {
    const choices: McpElicitationChoice[] = [];
    for (const entry of titled) {
      if (!isRecord(entry) || typeof entry["const"] !== "string") {
        return null;
      }
      const description = getStringProperty(entry, "description")?.trim();
      choices.push({
        value: entry["const"],
        label: getStringProperty(entry, "title") ?? entry["const"],
        ...(description ? { description } : {}),
      });
    }
    return choices.length > 0 ? choices : null;
  }
  const values = schema["enum"];
  if (!Array.isArray(values)) {
    return null;
  }
  const names = Array.isArray(schema["enumNames"]) ? schema["enumNames"] : [];
  const choices: McpElicitationChoice[] = [];
  values.forEach((value, index) => {
    if (typeof value !== "string" || value.trim() === "") {
      return;
    }
    const name = names[index];
    choices.push({
      value,
      label: typeof name === "string" && name.trim() !== "" ? name : value,
    });
  });
  return choices.length > 0 ? choices : null;
}

function readBound(
  schema: StringRecord,
  key: string,
  count: boolean,
): number | null {
  const value = schema[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return count && (!Number.isInteger(value) || value < 0) ? null : value;
}

function readBounds(
  schema: StringRecord,
  minKey: string,
  maxKey: string,
  count: boolean,
): Bounds | null {
  const bounds = {
    min: readBound(schema, minKey, count),
    max: readBound(schema, maxKey, count),
  };
  return bounds.min !== null && bounds.max !== null && bounds.min > bounds.max
    ? null
    : bounds;
}

function isTextFormat(value: string): value is TextFormat {
  return Object.hasOwn(TEXT_FORMAT_HINTS, value);
}

function readTextFormat(schema: StringRecord): TextFormat | null {
  const format = getStringProperty(schema, "format");
  return format !== undefined && isTextFormat(format) ? format : null;
}

function readField(schema: StringRecord): McpElicitationField | null {
  const type = getStringProperty(schema, "type");
  if (type === "array") {
    const items = schema["items"];
    const choices = isRecord(items) ? readChoices(items) : null;
    const bounds = readBounds(schema, "minItems", "maxItems", true);
    if (!choices || !bounds || (bounds.min ?? 0) > choices.length) {
      return null;
    }
    return { kind: "multiChoice", choices, items: bounds };
  }
  const choices = readChoices(schema);
  if (choices) {
    return { kind: "choice", choices };
  }
  switch (type) {
    case "boolean":
      return { kind: "boolean" };
    case "string": {
      const length = readBounds(schema, "minLength", "maxLength", true);
      return length && (length.min ?? 0) <= USER_QUESTION_MAX_FREE_TEXT_LENGTH
        ? { kind: "text", length, format: readTextFormat(schema) }
        : null;
    }
    case "number":
    case "integer": {
      const range = readBounds(schema, "minimum", "maximum", false);
      return range
        ? { kind: "number", integer: type === "integer", range }
        : null;
    }
    default:
      return null;
  }
}

function readRequiredNames(schema: unknown): Set<string> {
  const required = isRecord(schema) ? schema["required"] : undefined;
  return new Set(
    Array.isArray(required)
      ? required.filter((name): name is string => typeof name === "string")
      : [],
  );
}

function otherCompanionFor(
  entry: FormField,
  fieldsByName: ReadonlyMap<string, FormField>,
): OtherCompanion | null {
  if (entry.field.kind !== "choice" && entry.field.kind !== "multiChoice") {
    return null;
  }
  const choice = entry.field.choices.some(
    (option) => option.value === OTHER_CHOICE_VALUE,
  )
    ? OTHER_CHOICE_VALUE
    : null;
  if (entry.required && choice === null) {
    return null;
  }
  for (const suffix of OTHER_COMPANION_SUFFIXES) {
    const companion = fieldsByName.get(`${entry.name}${suffix}`);
    if (
      companion?.field.kind === "text" &&
      !companion.required &&
      companion.schema["format"] === undefined &&
      companion.field.length.min === null &&
      companion.field.length.max === null
    ) {
      return { name: companion.name, choice };
    }
  }
  return null;
}

function foldOtherCompanions(
  fields: readonly FormField[],
): Map<string, OtherCompanion> {
  const fieldsByName = new Map(fields.map((entry) => [entry.name, entry]));
  const companions = new Map<string, OtherCompanion>();
  const foldedNames = new Set<string>();
  for (const entry of fields) {
    if (foldedNames.has(entry.name)) {
      continue;
    }
    const other = otherCompanionFor(entry, fieldsByName);
    if (other !== null && !foldedNames.has(other.name)) {
      companions.set(entry.name, other);
      foldedNames.add(other.name);
    }
  }
  return companions;
}

function shownField(
  field: McpElicitationField,
  other: OtherCompanion | null,
): McpElicitationField | null {
  if (field.kind === "choice") {
    const choices = field.choices.filter(
      (option) => other === null || option.value !== other.choice,
    );
    return choices.length <= USER_QUESTION_MAX_OPTIONS
      ? { kind: "choice", choices }
      : { kind: "typedChoice", choices };
  }
  if (field.kind === "multiChoice") {
    const choices = field.choices.filter(
      (option) => other === null || option.value !== other.choice,
    );
    return choices.length <= USER_QUESTION_MAX_OPTIONS
      ? { ...field, choices }
      : null;
  }
  return field;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function boundsHint(
  bounds: Bounds,
  verb: string,
  noun: (count: number) => string,
): string | null {
  const { min, max } = bounds;
  if (min !== null && max !== null) {
    return min === max
      ? `${verb} exactly ${noun(min)}.`
      : `${verb} ${min} to ${noun(max)}.`;
  }
  if (min !== null) return `${verb} at least ${noun(min)}.`;
  if (max !== null) return `${verb} at most ${noun(max)}.`;
  return null;
}

function numberHint(field: { integer: boolean; range: Bounds }): string {
  const kind = field.integer ? "a whole number" : "a number";
  const { min, max } = field.range;
  if (min !== null && max !== null)
    return `Enter ${kind} from ${min} to ${max}.`;
  if (min !== null) return `Enter ${kind} of at least ${min}.`;
  if (max !== null) return `Enter ${kind} of at most ${max}.`;
  return `Enter ${kind}.`;
}

function fieldHints(field: McpElicitationField): string[] {
  switch (field.kind) {
    case "typedChoice":
      return [
        `One of: ${field.choices.map((choice) => choice.label).join(", ")}`,
      ];
    case "number":
      return [numberHint(field)];
    case "text":
      return [
        boundsHint(field.length, "Enter", (count) =>
          plural(count, "character"),
        ),
        field.format === null ? null : TEXT_FORMAT_HINTS[field.format],
      ].filter((hint): hint is string => hint !== null);
    case "multiChoice": {
      const hint = boundsHint(field.items, "Choose", (count) =>
        plural(count, "option"),
      );
      return hint === null ? [] : [hint];
    }
    case "choice":
    case "boolean":
      return [];
  }
}

function questionFor(
  name: string,
  schema: StringRecord,
  field: McpElicitationField,
  required: boolean,
  other: OtherCompanion | null,
  descriptionIsHeading: boolean,
): PendingInteractionUserQuestionQuestion {
  const label = getStringProperty(schema, "title")?.trim() || name;
  const description =
    getStringProperty(schema, "description")?.trim() || undefined;
  const heading = descriptionIsHeading ? description : undefined;
  const detail = descriptionIsHeading ? undefined : description;
  const lines = [label, ...(detail ? [detail] : []), ...fieldHints(field)];
  const base = {
    id: name,
    prompt: lines.join("\n"),
    shortLabel: heading ?? label,
    required,
  };
  switch (field.kind) {
    case "choice":
      return {
        ...base,
        multiSelect: false,
        options: field.choices,
        allowFreeText: other !== null,
      };
    case "multiChoice":
      return {
        ...base,
        multiSelect: true,
        options: field.choices,
        allowFreeText: other !== null,
      };
    case "boolean":
      return {
        ...base,
        multiSelect: false,
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        allowFreeText: false,
      };
    case "typedChoice":
    case "text":
    case "number":
      return { ...base, multiSelect: false, allowFreeText: true };
  }
}

function matchTypedChoice(
  choices: readonly McpElicitationChoice[],
  typed: string,
): string | null {
  const wanted = typed.toLowerCase();
  return (
    choices.find(
      (choice) =>
        choice.value.toLowerCase() === wanted ||
        choice.label.toLowerCase() === wanted,
    )?.value ?? null
  );
}

function otherContent(
  entry: PlannedField,
  typed: string,
): McpElicitationContent | null {
  if (entry.other === null) {
    return null;
  }
  return {
    ...(entry.other.choice === null
      ? {}
      : { [entry.name]: entry.other.choice }),
    [entry.other.name]: typed,
  };
}

function outsideBounds(
  value: number,
  bounds: Bounds,
  what: (limit: number) => string,
): string | null {
  if (bounds.min !== null && value < bounds.min) {
    return `must be at least ${what(bounds.min)}`;
  }
  if (bounds.max !== null && value > bounds.max) {
    return `must be at most ${what(bounds.max)}`;
  }
  return null;
}

type FieldAnswer =
  | { content: McpElicitationContent }
  | { misfit: string }
  | { retry: string };

function contentFor(
  entry: PlannedField,
  answer: PendingInteractionUserAnswer | undefined,
): FieldAnswer {
  const misfit = {
    misfit: `the answer to "${entry.name}" does not fit that field`,
  };
  const accept = (content: McpElicitationContent | null): FieldAnswer =>
    content === null ? misfit : { content };
  const selected = answer?.selected ?? [];
  const typed = answer?.freeText?.trim() || undefined;
  if (selected.length === 0 && typed === undefined) {
    return entry.required ? misfit : { content: {} };
  }
  const { field, name } = entry;
  switch (field.kind) {
    case "choice": {
      const [value] = selected;
      if (value === undefined) {
        return accept(typed === undefined ? null : otherContent(entry, typed));
      }
      if (!field.choices.some((choice) => choice.value === value)) {
        return misfit;
      }
      return accept({
        [name]: value,
        ...(typed !== undefined && entry.other !== null
          ? { [entry.other.name]: typed }
          : {}),
      });
    }
    case "multiChoice": {
      const allowed = new Set(field.choices.map((choice) => choice.value));
      if (!selected.every((value) => allowed.has(value))) {
        return misfit;
      }
      const other = typed === undefined ? null : entry.other;
      const values = [...selected, ...(other?.choice ? [other.choice] : [])];
      const count = outsideBounds(values.length, field.items, (limit) =>
        plural(limit, "option"),
      );
      if (count !== null && (values.length > 0 || entry.required)) {
        return { retry: count };
      }
      return accept({
        ...(values.length > 0 ? { [name]: values } : {}),
        ...(other !== null && typed !== undefined
          ? { [other.name]: typed }
          : {}),
      });
    }
    case "boolean": {
      const [value] = selected;
      return value === "true" || value === "false"
        ? accept({ [name]: value === "true" })
        : misfit;
    }
    case "typedChoice": {
      if (typed === undefined) {
        return misfit;
      }
      const match = matchTypedChoice(field.choices, typed);
      return accept(
        match === null ? otherContent(entry, typed) : { [name]: match },
      );
    }
    case "text": {
      if (typed === undefined) {
        return misfit;
      }
      const length = outsideBounds([...typed].length, field.length, (limit) =>
        plural(limit, "character"),
      );
      return length === null ? accept({ [name]: typed }) : { retry: length };
    }
    case "number": {
      if (typed === undefined) {
        return misfit;
      }
      if (!JSON_NUMBER.test(typed)) {
        return { retry: "must be a number" };
      }
      const parsed = Number(typed);
      if (field.integer && !Number.isInteger(parsed)) {
        return { retry: "must be a whole number" };
      }
      const range = outsideBounds(parsed, field.range, String);
      return range === null ? accept({ [name]: parsed }) : { retry: range };
    }
  }
}

function requesterLine(requester: McpElicitationRequester): string[] {
  if (requester.kind !== "mcp_server") {
    return [];
  }
  const name = requester.serverName.replace(/[`\r\n]/g, "").trim();
  return [
    name === ""
      ? "Requested by an MCP server"
      : `Requested by MCP server \`${name}\``,
  ];
}

function choiceQuestion(
  prompt: string,
  options: { value: string; label: string }[],
): UserQuestionPendingInteractionPayload {
  return {
    kind: "user_question",
    questions: [
      {
        id: CONFIRM_QUESTION_ID,
        prompt,
        multiSelect: false,
        options,
        allowFreeText: false,
        required: true,
      },
    ],
  };
}

function selectedChoice(
  resolution: UserQuestionPendingInteractionResolution,
): string | undefined {
  return resolution.answers[CONFIRM_QUESTION_ID]?.selected[0];
}

function planConfirmation(
  message: string | undefined,
  requester: McpElicitationRequester,
): McpElicitationPlan {
  return {
    kind: "questions",
    payload: choiceQuestion(
      [
        ...requesterLine(requester),
        message ??
          (requester.kind === "mcp_server"
            ? "The MCP server is asking you to confirm."
            : "The agent is asking you to confirm."),
      ].join("\n\n"),
      [
        { value: CONFIRM_ACCEPT_VALUE, label: "Accept" },
        { value: CONFIRM_DECLINE_VALUE, label: "Decline" },
      ],
    ),
    toResponse(resolution) {
      const selected = selectedChoice(resolution);
      if (selected === CONFIRM_ACCEPT_VALUE) {
        return { action: "accept", content: {} };
      }
      if (selected === CONFIRM_DECLINE_VALUE) {
        return { action: "decline" };
      }
      return { unmappable: "the answer was neither Accept nor Decline" };
    },
  };
}

function planDeclineGate(
  message: string | undefined,
  requester: McpElicitationRequester,
  labels: readonly string[],
  form: McpElicitationQuestions,
): McpElicitationQuestions {
  return {
    kind: "questions",
    payload: choiceQuestion(
      [
        ...requesterLine(requester),
        ...(message ? [message] : []),
        `The form asks for: ${labels.join(", ")}`,
      ].join("\n\n"),
      [
        { value: GATE_ANSWER_VALUE, label: "Fill in the form" },
        { value: CONFIRM_DECLINE_VALUE, label: "Decline" },
      ],
    ),
    toResponse(resolution) {
      const selected = selectedChoice(resolution);
      if (selected === GATE_ANSWER_VALUE) {
        return { next: form };
      }
      if (selected === CONFIRM_DECLINE_VALUE) {
        return { action: "decline" };
      }
      return {
        unmappable: "the answer was neither Fill in the form nor Decline",
      };
    },
  };
}

export function planMcpElicitation(
  params: unknown,
  requester: McpElicitationRequester,
): McpElicitationPlan {
  if (!isRecord(params)) {
    return { kind: "unsupported", reason: "the request was malformed" };
  }
  const mode = params["mode"];
  if (mode !== undefined && mode !== "form") {
    return {
      kind: "unsupported",
      reason: `bb does not offer the "${typeof mode === "string" ? mode : "unknown"}" elicitation mode`,
    };
  }
  const message = getStringProperty(params, "message")?.trim() || undefined;
  const schema = params["requestedSchema"];
  const properties = isRecord(schema) ? schema["properties"] : undefined;
  const entries = isRecord(properties) ? Object.entries(properties) : [];
  if (entries.length === 0) {
    return planConfirmation(message, requester);
  }

  const requiredNames = readRequiredNames(schema);
  const fields: FormField[] = [];
  for (const [name, fieldSchema] of entries) {
    const field = isRecord(fieldSchema) ? readField(fieldSchema) : null;
    if (name.trim() === "" || !isRecord(fieldSchema) || !field) {
      return {
        kind: "unsupported",
        reason: `bb cannot show the field "${name}"`,
      };
    }
    fields.push({
      name,
      schema: fieldSchema,
      field,
      required: requiredNames.has(name),
    });
  }

  const companions =
    requester.kind === "agent"
      ? foldOtherCompanions(fields)
      : new Map<string, OtherCompanion>();
  const foldedNames = new Set(
    [...companions.values()].map((other) => other.name),
  );
  const shown = fields.filter((entry) => !foldedNames.has(entry.name));
  if (shown.length > USER_QUESTION_MAX_QUESTIONS) {
    return {
      kind: "unsupported",
      reason: `bb shows at most ${USER_QUESTION_MAX_QUESTIONS} questions and this form has ${shown.length}`,
    };
  }

  const descriptionIsHeading =
    requester.kind === "agent" && requester.descriptionIsHeading;
  const planned: PlannedField[] = [];
  for (const entry of shown) {
    const other = companions.get(entry.name) ?? null;
    const field = shownField(entry.field, other);
    if (!field) {
      return {
        kind: "unsupported",
        reason: `bb cannot show the field "${entry.name}"`,
      };
    }
    const label =
      getStringProperty(entry.schema, "title")?.trim() || entry.name;
    planned.push({
      name: entry.name,
      label,
      field,
      required: entry.required,
      other,
      question: questionFor(
        entry.name,
        entry.schema,
        field,
        entry.required,
        other,
        descriptionIsHeading,
      ),
    });
  }

  const messageLead =
    message !== undefined && message !== planned[0]?.label ? [message] : [];
  const payloadWith = (
    notice: string | null,
  ): UserQuestionPendingInteractionPayload => ({
    kind: "user_question",
    questions: planned.map(({ question }, index) =>
      index === 0
        ? {
            ...question,
            prompt: [
              ...requesterLine(requester),
              ...(notice === null ? [] : [notice]),
              ...messageLead,
              question.prompt,
            ].join("\n\n"),
          }
        : question,
    ),
  });
  const payload = userQuestionPendingInteractionPayloadSchema.safeParse(
    payloadWith(null),
  );
  if (!payload.success) {
    return { kind: "unsupported", reason: "the form could not be shown" };
  }
  const formWith = (
    data: UserQuestionPendingInteractionPayload,
  ): McpElicitationQuestions => ({
    kind: "questions",
    payload: data,
    toResponse(resolution) {
      const content: McpElicitationContent = {};
      for (const entry of planned) {
        const answered = contentFor(entry, resolution.answers[entry.name]);
        if ("misfit" in answered) {
          return { unmappable: answered.misfit };
        }
        if ("retry" in answered) {
          return {
            next: formWith(
              payloadWith(
                `Your answer to "${entry.label}" ${answered.retry}. Answer again.`,
              ),
            ),
          };
        }
        Object.assign(content, answered.content);
      }
      return { action: "accept", content };
    },
  });
  const form = formWith(payload.data);
  return requester.kind === "mcp_server"
    ? planDeclineGate(
        message,
        requester,
        planned.map((entry) => entry.question.shortLabel ?? entry.name),
        form,
      )
    : form;
}
