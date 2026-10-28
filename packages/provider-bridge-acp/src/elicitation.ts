import {
  USER_QUESTION_MAX_OPTIONS,
  USER_QUESTION_MAX_QUESTIONS,
  userQuestionPendingInteractionPayloadSchema,
  type PendingInteractionUserAnswer,
  type PendingInteractionUserQuestionQuestion,
  type UserQuestionPendingInteractionPayload,
  type UserQuestionPendingInteractionResolution,
} from "@bb/domain";
import {
  normalizeElicitationForm,
  validateElicitationFormContent,
  type ElicitationFormContent,
  type ElicitationFormField,
} from "@bb/provider-bridge-protocol/bridge-kit/elicitation-form";
import { ZodError } from "zod";
import { isJsonObject, readString } from "./session/decode.js";

export type AcpElicitationResponse =
  | { action: "accept"; content: ElicitationFormContent }
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

type ChoiceField = Extract<
  ElicitationFormField,
  { kind: "enum" | "multi_enum" }
>;
type TextField = Extract<ElicitationFormField, { kind: "string" }>;
type FormValue = ElicitationFormContent[string];

interface OtherCompanion {
  field: TextField;
  choice: string | null;
}

interface PlannedQuestion {
  field: ElicitationFormField;
  other: OtherCompanion | null;
  typedChoice: boolean;
  question: PendingInteractionUserQuestionQuestion;
}

const CONFIRM_QUESTION_ID = "confirm";
const CONFIRM_ACCEPT_VALUE = "accept";
const CONFIRM_DECLINE_VALUE = "decline";
const OTHER_FIELD_SUFFIXES = ["__other", "_other"];
const OTHER_CHOICE = /^other\b/i;

function otherCompanionFor(
  field: ChoiceField,
  fieldsByName: ReadonlyMap<string, ElicitationFormField>,
): OtherCompanion | null {
  for (const suffix of OTHER_FIELD_SUFFIXES) {
    const companion = fieldsByName.get(`${field.name}${suffix}`);
    if (
      companion?.kind === "string" &&
      companion.format === null &&
      !companion.required
    ) {
      const choice = field.options.find(
        (option) =>
          OTHER_CHOICE.test(option.value) || OTHER_CHOICE.test(option.label),
      );
      return { field: companion, choice: choice?.value ?? null };
    }
  }
  return null;
}

function promptFor(
  field: ElicitationFormField,
  label: string,
  hint: string | null,
  message: string | undefined,
): string {
  const description = field.description?.trim();
  return [
    ...(message ? [message, ""] : []),
    label,
    ...(description ? [description] : []),
    ...(hint ? [hint] : []),
  ].join("\n");
}

function planQuestion(
  field: ElicitationFormField,
  other: OtherCompanion | null,
  message: string | undefined,
): PlannedQuestion | string {
  const label = field.title.trim() || field.name;
  const base = { id: field.name, shortLabel: label, required: field.required };
  const ask = (
    hint: string | null,
    shape: Pick<
      PendingInteractionUserQuestionQuestion,
      "multiSelect" | "options" | "allowFreeText"
    >,
    typedChoice = false,
  ): PlannedQuestion => ({
    field,
    other,
    typedChoice,
    question: {
      ...base,
      prompt: promptFor(field, label, hint, message),
      ...shape,
    },
  });
  switch (field.kind) {
    case "enum":
    case "multi_enum": {
      const options = field.options.filter(
        (option) => other === null || option.value !== other.choice,
      );
      const multiSelect = field.kind === "multi_enum";
      if (options.length <= USER_QUESTION_MAX_OPTIONS) {
        return ask(null, {
          multiSelect,
          options,
          allowFreeText: other !== null,
        });
      }
      if (multiSelect) {
        return `bb cannot show the field "${field.name}": it offers more than ${USER_QUESTION_MAX_OPTIONS} choices`;
      }
      return ask(
        `One of: ${options.map((option) => option.label).join(", ")}`,
        { multiSelect: false, allowFreeText: true },
        true,
      );
    }
    case "boolean":
      return ask(null, {
        multiSelect: false,
        options: [
          { value: "true", label: "Yes" },
          { value: "false", label: "No" },
        ],
        allowFreeText: false,
      });
    case "string":
      return ask(null, { multiSelect: false, allowFreeText: true });
    case "number":
    case "integer":
      return ask(
        field.kind === "integer" ? "Enter a whole number." : "Enter a number.",
        { multiSelect: false, allowFreeText: true },
      );
  }
}

function matchTypedChoice(field: ChoiceField, typed: string): string | null {
  const wanted = typed.toLowerCase();
  return (
    field.options.find(
      (option) =>
        option.value.toLowerCase() === wanted ||
        option.label.toLowerCase() === wanted,
    )?.value ?? null
  );
}

function contentFor(
  planned: PlannedQuestion,
  answer: PendingInteractionUserAnswer | undefined,
): Record<string, FormValue> {
  const { field, other } = planned;
  const selected = answer?.selected ?? [];
  const typed = answer?.freeText?.trim() || null;
  const content: Record<string, FormValue> = {};
  switch (field.kind) {
    case "enum": {
      const matched =
        selected[0] === undefined && typed !== null && planned.typedChoice
          ? matchTypedChoice(field, typed)
          : null;
      const value =
        selected[0] ??
        matched ??
        (typed === null ? null : other === null ? typed : other.choice);
      if (value !== null) content[field.name] = value;
      if (other !== null && typed !== null && matched === null) {
        content[other.field.name] = typed;
      }
      return content;
    }
    case "multi_enum": {
      const values =
        typed !== null && other?.choice
          ? [...selected, other.choice]
          : [...selected];
      if (values.length > 0) content[field.name] = values;
      if (typed !== null && other !== null) content[other.field.name] = typed;
      return content;
    }
    case "boolean":
      if (selected[0] !== undefined) {
        content[field.name] = selected[0] === "true";
      }
      return content;
    case "string":
      if (typed !== null) content[field.name] = typed;
      return content;
    case "number":
    case "integer": {
      if (typed === null) return content;
      const parsed = Number(typed);
      content[field.name] = Number.isFinite(parsed) ? parsed : typed;
      return content;
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

function unreadableFormReason(error: unknown): string {
  if (error instanceof ZodError) {
    const [scope, name] = error.issues[0]?.path ?? [];
    return scope === "properties" && typeof name === "string"
      ? `bb cannot show the field "${name}"`
      : "bb cannot read the form's schema";
  }
  return error instanceof Error
    ? `the form is invalid: ${error.message.replace(/\.$/u, "")}`
    : "bb cannot read the form's schema";
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
  if (params["requestedSchema"] === undefined) {
    return planConfirmation(message);
  }
  let fields: ElicitationFormField[];
  try {
    fields = normalizeElicitationForm(params["requestedSchema"]);
  } catch (error) {
    return { kind: "unsupported", reason: unreadableFormReason(error) };
  }
  if (fields.length === 0) {
    return planConfirmation(message);
  }

  const fieldsByName = new Map(fields.map((field) => [field.name, field]));
  const companions = new Map<string, OtherCompanion>();
  const foldedNames = new Set<string>();
  for (const field of fields) {
    if (field.kind !== "enum" && field.kind !== "multi_enum") continue;
    const other = otherCompanionFor(field, fieldsByName);
    if (other !== null && !foldedNames.has(other.field.name)) {
      companions.set(field.name, other);
      foldedNames.add(other.field.name);
    }
  }
  const shown = fields.filter((field) => !foldedNames.has(field.name));
  if (shown.length > USER_QUESTION_MAX_QUESTIONS) {
    return {
      kind: "unsupported",
      reason: `bb shows at most ${USER_QUESTION_MAX_QUESTIONS} questions; this form has ${shown.length}`,
    };
  }

  const planned: PlannedQuestion[] = [];
  for (const field of shown) {
    const entry = planQuestion(
      field,
      companions.get(field.name) ?? null,
      planned.length === 0 ? message : undefined,
    );
    if (typeof entry === "string") {
      return { kind: "unsupported", reason: entry };
    }
    planned.push(entry);
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
      const content: Record<string, FormValue> = {};
      for (const entry of planned) {
        Object.assign(
          content,
          contentFor(entry, resolution.answers[entry.field.name]),
        );
      }
      const validated = validateElicitationFormContent(fields, content);
      return validated.success
        ? { action: "accept", content: validated.data }
        : { action: "decline" };
    },
  };
}
