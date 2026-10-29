import {
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  userQuestionPendingInteractionPayloadSchema,
  type PendingInteractionUserAnswer,
  type PendingInteractionUserQuestionQuestion,
  type UserQuestionPendingInteractionPayload,
  type UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import { isJsonObject, readString } from "./session/decode.js";
import type { AcpJsonObject } from "./session/session-types.js";

export type AcpElicitationResponse =
  | { action: "accept"; content: Record<string, unknown> }
  | { action: "decline" }
  | { action: "cancel" };

export type AcpElicitationPlan =
  | {
      kind: "questions";
      payload: UserQuestionPendingInteractionPayload;
      toResponse(
        resolution: UserQuestionPendingInteractionResolution,
      ): AcpElicitationResponse;
    }
  | { kind: "unsupported"; reason: string };

interface AcpElicitationChoice {
  value: string;
  label: string;
}

type AcpElicitationField =
  | { kind: "choice"; choices: AcpElicitationChoice[] }
  | { kind: "typedChoice"; choices: AcpElicitationChoice[] }
  | { kind: "multiChoice"; choices: AcpElicitationChoice[] }
  | { kind: "boolean" }
  | { kind: "text" }
  | { kind: "number"; integer: boolean };

interface FormField {
  name: string;
  schema: AcpJsonObject;
  field: AcpElicitationField;
  required: boolean;
}

interface OtherCompanion {
  name: string;
  choice: string | null;
}

interface PlannedField {
  name: string;
  field: AcpElicitationField;
  required: boolean;
  other: OtherCompanion | null;
  question: PendingInteractionUserQuestionQuestion;
}

const CONFIRM_QUESTION_ID = "confirm";
const CONFIRM_ACCEPT_VALUE = "accept";
const CONFIRM_DECLINE_VALUE = "decline";

const OTHER_COMPANION_SUFFIXES = ["__other", "_other"] as const;
const OTHER_CHOICE_VALUE = "other";

function readChoices(schema: AcpJsonObject): AcpElicitationChoice[] | null {
  const titled = schema["oneOf"] ?? schema["anyOf"];
  if (Array.isArray(titled)) {
    const choices: AcpElicitationChoice[] = [];
    for (const entry of titled) {
      if (!isJsonObject(entry) || typeof entry["const"] !== "string") {
        return null;
      }
      choices.push({
        value: entry["const"],
        label: readString(entry, "title") ?? entry["const"],
      });
    }
    return choices.length > 0 ? choices : null;
  }
  const values = schema["enum"];
  if (!Array.isArray(values)) {
    return null;
  }
  const names = Array.isArray(schema["enumNames"]) ? schema["enumNames"] : [];
  const choices: AcpElicitationChoice[] = [];
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

function readField(schema: AcpJsonObject): AcpElicitationField | null {
  const type = readString(schema, "type");
  if (type === "array") {
    const items = schema["items"];
    const choices = isJsonObject(items) ? readChoices(items) : null;
    return choices ? { kind: "multiChoice", choices } : null;
  }
  const choices = readChoices(schema);
  if (choices) {
    return { kind: "choice", choices };
  }
  switch (type) {
    case "boolean":
      return { kind: "boolean" };
    case "string":
      return { kind: "text" };
    case "number":
      return { kind: "number", integer: false };
    case "integer":
      return { kind: "number", integer: true };
    default:
      return null;
  }
}

function readRequiredNames(schema: unknown): Set<string> {
  const required = isJsonObject(schema) ? schema["required"] : undefined;
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
      companion.schema["format"] === undefined
    ) {
      return { name: companion.name, choice };
    }
  }
  return null;
}

function shownField(
  field: AcpElicitationField,
  other: OtherCompanion | null,
): AcpElicitationField | null {
  if (field.kind !== "choice" && field.kind !== "multiChoice") {
    return field;
  }
  const choices = field.choices.filter(
    (option) => other === null || option.value !== other.choice,
  );
  if (choices.length <= USER_QUESTION_MAX_OPTIONS) {
    return { kind: field.kind, choices };
  }
  return field.kind === "choice" ? { kind: "typedChoice", choices } : null;
}

function questionFor(
  name: string,
  schema: AcpJsonObject,
  field: AcpElicitationField,
  required: boolean,
  other: OtherCompanion | null,
  message: string | undefined,
): PendingInteractionUserQuestionQuestion {
  const label = readString(schema, "title")?.trim() || name;
  const description = readString(schema, "description")?.trim();
  const lines = [
    ...(message ? [message, ""] : []),
    label,
    ...(description ? [description] : []),
    ...(field.kind === "typedChoice"
      ? [`One of: ${field.choices.map((choice) => choice.label).join(", ")}`]
      : []),
    ...(field.kind === "number"
      ? [field.integer ? "Enter a whole number." : "Enter a number."]
      : []),
  ];
  const base = {
    id: name,
    prompt: lines.join("\n"),
    shortLabel: label,
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
  choices: readonly AcpElicitationChoice[],
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
): Record<string, unknown> | null {
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

function contentFor(
  entry: PlannedField,
  answer: PendingInteractionUserAnswer | undefined,
): Record<string, unknown> | null {
  const selected = answer?.selected ?? [];
  const typed = answer?.freeText?.trim() || undefined;
  if (selected.length === 0 && typed === undefined) {
    return entry.required ? null : {};
  }
  const { field, name } = entry;
  switch (field.kind) {
    case "choice": {
      const [value] = selected;
      if (value === undefined) {
        return typed === undefined ? null : otherContent(entry, typed);
      }
      if (!field.choices.some((choice) => choice.value === value)) {
        return null;
      }
      return {
        [name]: value,
        ...(typed !== undefined && entry.other !== null
          ? { [entry.other.name]: typed }
          : {}),
      };
    }
    case "multiChoice": {
      const allowed = new Set(field.choices.map((choice) => choice.value));
      if (!selected.every((value) => allowed.has(value))) {
        return null;
      }
      const other = typed === undefined ? null : entry.other;
      const values = [...selected, ...(other?.choice ? [other.choice] : [])];
      return {
        ...(values.length > 0 ? { [name]: values } : {}),
        ...(other !== null && typed !== undefined
          ? { [other.name]: typed }
          : {}),
      };
    }
    case "boolean": {
      const [value] = selected;
      return value === "true" || value === "false"
        ? { [name]: value === "true" }
        : null;
    }
    case "typedChoice": {
      if (typed === undefined) {
        return null;
      }
      const match = matchTypedChoice(field.choices, typed);
      return match === null ? otherContent(entry, typed) : { [name]: match };
    }
    case "text":
      return typed === undefined ? null : { [name]: typed };
    case "number": {
      if (typed === undefined) {
        return null;
      }
      const parsed = Number(typed);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return field.integer && !Number.isInteger(parsed)
        ? null
        : { [name]: parsed };
    }
  }
}

function planConfirmation(message: string | undefined): AcpElicitationPlan {
  const payload: UserQuestionPendingInteractionPayload = {
    kind: "user_question",
    questions: [
      {
        id: CONFIRM_QUESTION_ID,
        prompt: message ?? "The agent is asking you to confirm.",
        multiSelect: false,
        options: [
          { value: CONFIRM_ACCEPT_VALUE, label: "Accept" },
          { value: CONFIRM_DECLINE_VALUE, label: "Decline" },
        ],
        allowFreeText: false,
        required: true,
      },
    ],
  };
  return {
    kind: "questions",
    payload,
    toResponse(resolution) {
      return resolution.answers[CONFIRM_QUESTION_ID]?.selected[0] ===
        CONFIRM_ACCEPT_VALUE
        ? { action: "accept", content: {} }
        : { action: "decline" };
    },
  };
}

export function planAcpElicitation(params: unknown): AcpElicitationPlan {
  if (!isJsonObject(params)) {
    return { kind: "unsupported", reason: "the request was malformed" };
  }
  const mode = readString(params, "mode");
  if (mode !== "form") {
    return {
      kind: "unsupported",
      reason: `bb does not offer the "${mode ?? "unknown"}" elicitation mode`,
    };
  }
  const message = readString(params, "message")?.trim() || undefined;
  const schema = params["requestedSchema"];
  const properties = isJsonObject(schema) ? schema["properties"] : undefined;
  const entries = isJsonObject(properties) ? Object.entries(properties) : [];
  if (entries.length === 0) {
    return planConfirmation(message);
  }

  const requiredNames = readRequiredNames(schema);
  const fields: FormField[] = [];
  for (const [name, fieldSchema] of entries) {
    const field = isJsonObject(fieldSchema) ? readField(fieldSchema) : null;
    if (name.trim() === "" || !isJsonObject(fieldSchema) || !field) {
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
  const shown = fields.filter((entry) => !foldedNames.has(entry.name));
  if (shown.length > USER_QUESTION_MAX_QUESTIONS) {
    return {
      kind: "unsupported",
      reason: `bb shows at most ${USER_QUESTION_MAX_QUESTIONS} questions and this form has ${shown.length}`,
    };
  }

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
    planned.push({
      name: entry.name,
      field,
      required: entry.required,
      other,
      question: questionFor(
        entry.name,
        entry.schema,
        field,
        entry.required,
        other,
        planned.length === 0 ? message : undefined,
      ),
    });
  }

  const payload = userQuestionPendingInteractionPayloadSchema.safeParse({
    kind: "user_question",
    questions: planned.map((entry) => entry.question),
  });
  if (!payload.success) {
    return { kind: "unsupported", reason: "the form could not be shown" };
  }
  return {
    kind: "questions",
    payload: payload.data,
    toResponse(resolution) {
      const content: Record<string, unknown> = {};
      for (const entry of planned) {
        const answered = contentFor(entry, resolution.answers[entry.name]);
        if (!answered) {
          return { action: "decline" };
        }
        Object.assign(content, answered);
      }
      return { action: "accept", content };
    },
  };
}
