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

interface PlannedField {
  name: string;
  field: AcpElicitationField;
  question: PendingInteractionUserQuestionQuestion;
}

const CONFIRM_QUESTION_ID = "confirm";
const CONFIRM_ACCEPT_VALUE = "accept";
const CONFIRM_DECLINE_VALUE = "decline";

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

function planField(schema: AcpJsonObject): AcpElicitationField | null {
  const type = readString(schema, "type");
  if (type === "array") {
    const items = schema["items"];
    const choices = isJsonObject(items) ? readChoices(items) : null;
    return choices && choices.length <= USER_QUESTION_MAX_OPTIONS
      ? { kind: "multiChoice", choices }
      : null;
  }
  const choices = readChoices(schema);
  if (choices) {
    return choices.length <= USER_QUESTION_MAX_OPTIONS
      ? { kind: "choice", choices }
      : { kind: "typedChoice", choices };
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

function questionFor(
  name: string,
  schema: AcpJsonObject,
  field: AcpElicitationField,
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
  };
  switch (field.kind) {
    case "choice":
      return {
        ...base,
        multiSelect: false,
        options: field.choices,
        allowFreeText: false,
      };
    case "multiChoice":
      return {
        ...base,
        multiSelect: true,
        options: field.choices,
        allowFreeText: false,
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

function decodeAnswer(
  field: AcpElicitationField,
  answer: PendingInteractionUserAnswer | undefined,
): { value: unknown } | null {
  if (!answer) {
    return null;
  }
  const typed = answer.freeText?.trim();
  switch (field.kind) {
    case "choice": {
      const selected = answer.selected[0];
      return field.choices.some((choice) => choice.value === selected)
        ? { value: selected }
        : null;
    }
    case "multiChoice": {
      const allowed = new Set(field.choices.map((choice) => choice.value));
      return answer.selected.every((value) => allowed.has(value))
        ? { value: [...answer.selected] }
        : null;
    }
    case "boolean": {
      const selected = answer.selected[0];
      return selected === "true" || selected === "false"
        ? { value: selected === "true" }
        : null;
    }
    case "typedChoice": {
      if (!typed) {
        return null;
      }
      const wanted = typed.toLowerCase();
      const match = field.choices.find(
        (choice) =>
          choice.value.toLowerCase() === wanted ||
          choice.label.toLowerCase() === wanted,
      );
      return match ? { value: match.value } : null;
    }
    case "text":
      return typed ? { value: typed } : null;
    case "number": {
      if (!typed) {
        return null;
      }
      const parsed = Number(typed);
      if (!Number.isFinite(parsed)) {
        return null;
      }
      return field.integer && !Number.isInteger(parsed)
        ? null
        : { value: parsed };
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
  if (entries.length > USER_QUESTION_MAX_QUESTIONS) {
    return {
      kind: "unsupported",
      reason: `the form has ${entries.length} fields and bb shows at most ${USER_QUESTION_MAX_QUESTIONS}`,
    };
  }

  const planned: PlannedField[] = [];
  for (const [name, fieldSchema] of entries) {
    const field = isJsonObject(fieldSchema) ? planField(fieldSchema) : null;
    if (name.trim() === "" || !isJsonObject(fieldSchema) || !field) {
      return {
        kind: "unsupported",
        reason: `bb cannot show the field "${name}"`,
      };
    }
    planned.push({
      name,
      field,
      question: questionFor(
        name,
        fieldSchema,
        field,
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
        const decoded = decodeAnswer(
          entry.field,
          resolution.answers[entry.name],
        );
        if (!decoded) {
          return { action: "decline" };
        }
        content[entry.name] = decoded.value;
      }
      return { action: "accept", content };
    },
  };
}
