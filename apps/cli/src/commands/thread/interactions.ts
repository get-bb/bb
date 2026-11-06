import { flag } from "@bb/operations";
import type { Command } from "commander";
import type { CliValues } from "@bb/operations";
import {
  assertNever,
  buildPendingInteractionApprovalResolution,
  formatPendingInteractionApprovalResolutionOutcome,
  formatPendingInteractionSubjectDetailLines,
  formatPendingInteractionSummary,
  formatPendingInteractionUserQuestionOptionLabel,
  summarizePendingInteractionRequestedPermissions,
} from "@bb/core-ui";
import {
  isApprovalPendingInteraction,
  isApprovalPendingInteractionPayload,
  isApprovalPendingInteractionResolution,
  isPluginPendingInteraction,
  isPluginPendingInteractionPayload,
  isUserQuestionPendingInteraction,
  isUserQuestionPendingInteractionPayload,
  jsonValueSchema,
  parseExtensionKind,
  PendingInteraction,
  type ApprovalPendingInteraction,
  type JsonValue,
  type PluginExtensionPendingInteraction,
  type PluginPendingInteraction,
  type PendingInteractionUserAnswer,
  type PendingInteractionApprovalDecision,
  type PendingInteractionGrantablePermissionProfile,
  type PendingInteractionRequestedPermissionProfile,
  PendingInteractionResolution,
  type UserQuestionPendingInteraction,
  type UserQuestionPendingInteractionPayload,
} from "@bb/domain";
import {
  clientCommand,
  mountCommands,
  publicCommand,
  type CliClient,
  type CliCommand,
} from "../../operation-doors.js";
import { printBorderlessTable } from "../../table.js";
import { prependErrorContext } from "../helpers.js";
import {
  JSON_OPTION,
  OPTIONAL_THREAD_ID,
  SELF_OPTION,
  optionalString,
  stringList,
} from "./operation-doors.js";

function parseRespondValue(raw: string): JsonValue {
  try {
    return jsonValueSchema.parse(JSON.parse(raw));
  } catch {
    throw new Error("Invalid --value. Expected a JSON value.");
  }
}

type PrintablePermissionProfile =
  | PendingInteractionGrantablePermissionProfile
  | PendingInteractionRequestedPermissionProfile;
type UserQuestionQuestion =
  UserQuestionPendingInteractionPayload["questions"][number];

interface ChoiceFlagParseInput {
  rawValue: string;
}

interface ChoiceFlagEntry {
  questionId: string | null;
  value: string;
}

interface ResolveChoiceQuestionInput {
  entry: ChoiceFlagEntry;
  interaction: UserQuestionPendingInteraction;
  questionById: Map<string, UserQuestionQuestion>;
}

interface ResolveTextQuestionInput {
  interaction: UserQuestionPendingInteraction;
  questionById: Map<string, UserQuestionQuestion>;
  rawValue: string;
}

interface TextQuestionAnswer {
  questionId: string;
  value: string;
}

interface BuildUserAnswerResolutionArgs {
  choiceValues: readonly string[];
  interaction: PendingInteraction;
  textValues: readonly string[];
}

function parsePermissionGrantScope(
  value: string | undefined,
): "session" | "turn" {
  if (value === undefined) {
    return "session";
  }

  if (value === "turn" || value === "session") {
    return value;
  }

  throw new Error("Invalid --scope. Expected 'turn' or 'session'.");
}

function formatInteractionKind(interaction: PendingInteraction): string {
  if (isUserQuestionPendingInteractionPayload(interaction.payload)) {
    return "question";
  }

  if (isPluginPendingInteractionPayload(interaction.payload)) {
    return "plugin";
  }
  if (!isApprovalPendingInteractionPayload(interaction.payload)) {
    return interaction.payload.kind;
  }

  switch (interaction.payload.subject.kind) {
    case "command":
      return "command";
    case "file_change":
      return "file-change";
    case "permission_grant":
      return "permission";
    case "plan":
      return "plan";
    case "tool_use":
      return "tool-use";
    default:
      return assertNever(interaction.payload.subject);
  }
}

function requireApprovalInteraction(
  interaction: PendingInteraction,
): ApprovalPendingInteraction {
  if (isApprovalPendingInteraction(interaction)) {
    return interaction;
  }
  throw new Error(
    `Interaction ${interaction.id} is ${formatInteractionKind(interaction)} and cannot be resolved with this command.`,
  );
}

function requireUserQuestionInteraction(
  interaction: PendingInteraction,
): UserQuestionPendingInteraction {
  if (isUserQuestionPendingInteraction(interaction)) {
    return interaction;
  }
  throw new Error(
    `Interaction ${interaction.id} is ${formatInteractionKind(interaction)} and cannot be answered with this command.`,
  );
}

function printUserQuestionInteraction(
  interaction: UserQuestionPendingInteraction,
): void {
  console.log("  Questions:");
  for (const question of interaction.payload.questions) {
    const label = question.shortLabel ? `${question.shortLabel}: ` : "";
    console.log(`    - ${label}${question.prompt}`);
    if (question.options && question.options.length > 0) {
      console.log(
        `      Options: ${question.options
          .map((option) => option.label)
          .join(", ")}`,
      );
    }
    if (question.allowFreeText) {
      console.log("      Free text: allowed");
    }
    if (!question.required) {
      console.log("      Optional: may be left unanswered");
    }
  }

  if (!interaction.resolution) {
    return;
  }

  console.log("");
  console.log("Answers:");
  for (const question of interaction.payload.questions) {
    const answer = interaction.resolution.answers[question.id];
    if (!answer) {
      continue;
    }
    const selectedLabels = answer.selected.map((value) =>
      formatPendingInteractionUserQuestionOptionLabel({ question, value }),
    );
    const parts = [
      ...selectedLabels,
      ...(answer.freeText ? [answer.freeText] : []),
    ];
    console.log(
      `  ${question.shortLabel ?? question.prompt}: ${parts.join(", ")}`,
    );
  }
}

function printApprovalInteraction(
  interaction: ApprovalPendingInteraction,
): void {
  switch (interaction.payload.subject.kind) {
    case "command":
    case "file_change":
      for (const line of formatPendingInteractionSubjectDetailLines(
        interaction,
      )) {
        console.log(`  ${line}`);
      }
      break;
    case "permission_grant":
      if (interaction.payload.subject.toolName) {
        console.log(`  Tool: ${interaction.payload.subject.toolName}`);
      }
      printRequestedPermissions(interaction.payload.subject.permissions);
      break;
    case "plan":
      if (interaction.payload.subject.planFilePath) {
        console.log(`  Plan file: ${interaction.payload.subject.planFilePath}`);
      }
      console.log("  Plan:");
      for (const line of interaction.payload.subject.plan.split("\n")) {
        console.log(`    ${line}`);
      }
      break;
    case "tool_use":
      for (const line of formatPendingInteractionSubjectDetailLines(
        interaction,
      )) {
        console.log(`  ${line}`);
      }
      break;
    default:
      assertNever(interaction.payload.subject);
  }
  if (interaction.payload.reason) {
    console.log(`  Prompt: ${interaction.payload.reason}`);
  }
  console.log(
    `  Decisions: ${interaction.payload.availableDecisions.join(", ")}`,
  );

  if (interaction.resolution) {
    console.log("");
    console.log("Resolution:");
    console.log(`  Decision: ${interaction.resolution.decision}`);
    if (interaction.resolution.decision === "allow_for_session") {
      console.log("  Scope: session");
    } else if (interaction.resolution.decision === "allow_once") {
      console.log("  Scope: turn");
    }
  }
}

function printRequestedPermissions(
  permissions: PrintablePermissionProfile,
): void {
  const summaries =
    summarizePendingInteractionRequestedPermissions(permissions);
  if (summaries.length === 0) {
    return;
  }

  console.log("  Permissions:");
  for (const summary of summaries) {
    console.log(`    - ${summary}`);
  }
}

function printInteraction(interaction: PendingInteraction): void {
  console.log(`Interaction: ${interaction.id}`);
  console.log(`  Thread: ${interaction.threadId}`);
  console.log(`  Kind: ${formatInteractionKind(interaction)}`);
  console.log(`  Status: ${interaction.status}`);
  console.log(`  Created: ${new Date(interaction.createdAt).toLocaleString()}`);
  if (interaction.resolvedAt !== null) {
    console.log(
      `  Resolved: ${new Date(interaction.resolvedAt).toLocaleString()}`,
    );
  }
  if (interaction.statusReason) {
    console.log(`  Reason: ${interaction.statusReason}`);
  }
  if (interaction.status === "resolving") {
    console.log("  Delivery: waiting for provider acknowledgement");
  }

  if (isUserQuestionPendingInteraction(interaction)) {
    printUserQuestionInteraction(interaction);
    return;
  }
  if (isApprovalPendingInteraction(interaction)) {
    printApprovalInteraction(interaction);
    return;
  }
  printPluginRequestInteraction(interaction);
}

function printPluginRequestInteraction(
  interaction: PluginPendingInteraction | PluginExtensionPendingInteraction,
): void {
  const form = isPluginPendingInteraction(interaction)
    ? {
        pluginId: interaction.origin.pluginId,
        rendererId: interaction.origin.rendererId,
        raisedBy: "plugin",
      }
    : {
        pluginId: parseExtensionKind(interaction.payload.kind).pluginId,
        rendererId: parseExtensionKind(interaction.payload.kind).name,
        raisedBy: "agent",
      };
  console.log(`  Title: ${interaction.payload.title}`);
  console.log(
    `  Form: ${form.pluginId}/${form.rendererId} (raised by ${form.raisedBy})`,
  );
  console.log(`  Data: ${JSON.stringify(interaction.payload.data)}`);
  console.log(
    "  Answer: bb thread interactions respond <interactionId> --value '<json>'",
  );
}

function parseChoiceFlagValue(input: ChoiceFlagParseInput): ChoiceFlagEntry {
  const separatorIndex = input.rawValue.indexOf("=");
  if (separatorIndex === -1) {
    return {
      questionId: null,
      value: input.rawValue,
    };
  }

  const questionId = input.rawValue.slice(0, separatorIndex);
  const value = input.rawValue.slice(separatorIndex + 1);
  if (questionId.length === 0 || value.length === 0) {
    throw new Error(
      "Invalid --choice value. Expected questionId=value or a single-question shorthand value.",
    );
  }
  return {
    questionId,
    value,
  };
}

function resolveChoiceQuestionId({
  entry,
  interaction,
  questionById,
}: ResolveChoiceQuestionInput): string {
  if (entry.questionId !== null) {
    if (!questionById.has(entry.questionId)) {
      throw new Error(
        `Answer references unknown question '${entry.questionId}'.`,
      );
    }
    return entry.questionId;
  }

  if (interaction.payload.questions.length !== 1) {
    throw new Error(
      "--choice shorthand can only be used for single-question interactions.",
    );
  }
  return interaction.payload.questions[0].id;
}

function resolveTextQuestionAnswer({
  interaction,
  questionById,
  rawValue,
}: ResolveTextQuestionInput): TextQuestionAnswer {
  const separatorIndex = rawValue.indexOf("=");
  if (separatorIndex !== -1) {
    const questionId = rawValue.slice(0, separatorIndex);
    if (questionById.has(questionId)) {
      return {
        questionId,
        value: rawValue.slice(separatorIndex + 1),
      };
    }
    if (interaction.payload.questions.length > 1) {
      throw new Error(`Answer references unknown question '${questionId}'.`);
    }
  }

  if (interaction.payload.questions.length === 1) {
    return {
      questionId: interaction.payload.questions[0].id,
      value: rawValue,
    };
  }

  throw new Error(
    "Multiple-question interactions require --text questionId=text.",
  );
}

function validateAnswerChoice(
  question: UserQuestionQuestion,
  answer: PendingInteractionUserAnswer,
  value: string,
): void {
  const optionValues = new Set(
    (question.options ?? []).map((option) => option.value),
  );
  if (!optionValues.has(value)) {
    throw new Error(
      `Question '${question.id}' does not offer choice '${value}'.`,
    );
  }
  if (answer.selected.includes(value)) {
    throw new Error(
      `Question '${question.id}' includes duplicate choice '${value}'.`,
    );
  }
  if (!question.multiSelect && answer.selected.length > 0) {
    throw new Error(`Question '${question.id}' accepts only one choice.`);
  }
}

function validateAnswerText(
  question: UserQuestionQuestion,
  answer: PendingInteractionUserAnswer,
  value: string,
): string {
  const trimmed = value.trim();
  if (!question.allowFreeText) {
    throw new Error(`Question '${question.id}' does not accept free text.`);
  }
  if (trimmed.length === 0) {
    throw new Error(`Question '${question.id}' free text cannot be empty.`);
  }
  if (answer.freeText !== undefined) {
    throw new Error(
      `Question '${question.id}' has multiple free-text answers.`,
    );
  }
  return trimmed;
}

function buildUserAnswerResolution({
  choiceValues,
  interaction,
  textValues,
}: BuildUserAnswerResolutionArgs): PendingInteractionResolution {
  const questionInteraction = requireUserQuestionInteraction(interaction);
  const questionById = new Map(
    questionInteraction.payload.questions.map((question) => [
      question.id,
      question,
    ]),
  );
  const answers: Record<string, PendingInteractionUserAnswer> = {};

  for (const rawValue of choiceValues) {
    const entry = parseChoiceFlagValue({ rawValue });
    const questionId = resolveChoiceQuestionId({
      entry,
      interaction: questionInteraction,
      questionById,
    });
    const question = questionById.get(questionId);
    if (!question) {
      throw new Error(`Answer references unknown question '${questionId}'.`);
    }
    const answer = answers[questionId] ?? { selected: [] };
    validateAnswerChoice(question, answer, entry.value);
    answer.selected = [...answer.selected, entry.value];
    answers[questionId] = answer;
  }

  for (const rawValue of textValues) {
    const textAnswer = resolveTextQuestionAnswer({
      interaction: questionInteraction,
      questionById,
      rawValue,
    });
    const question = questionById.get(textAnswer.questionId);
    if (!question) {
      throw new Error(
        `Answer references unknown question '${textAnswer.questionId}'.`,
      );
    }
    const answer = answers[textAnswer.questionId] ?? { selected: [] };
    answer.freeText = validateAnswerText(question, answer, textAnswer.value);
    answers[textAnswer.questionId] = answer;
  }

  for (const question of questionInteraction.payload.questions) {
    const answer = answers[question.id];
    if (
      question.required &&
      (!answer ||
        (answer.selected.length === 0 && answer.freeText === undefined))
    ) {
      throw new Error(`Missing answer for question '${question.id}'.`);
    }
  }

  return {
    kind: "user_answer",
    answers,
  };
}

interface ResolveInteractionSuccessMessageArgs {
  interactionId: string;
  resolution: PendingInteractionResolution;
  updated: PendingInteraction;
}

interface InteractionTarget {
  id: string;
  interactionId: string;
}

interface InteractionResolveInput extends InteractionTarget {
  scope?: "session" | "turn";
  choiceValues?: readonly string[];
  textValues?: readonly string[];
}

interface InteractionResolveOutput {
  resolution: PendingInteractionResolution;
  updated: PendingInteraction;
}

async function resolveInteraction(
  client: CliClient,
  target: InteractionTarget,
  failureAction: string,
  buildResolution: (
    interaction: PendingInteraction,
  ) => PendingInteractionResolution,
): Promise<InteractionResolveOutput> {
  const interaction = await client.call("threads.interaction", target);
  const resolution = buildResolution(interaction);
  const updated = await client
    .call("threads.resolveInteraction", { ...target, ...resolution })
    .catch((error: unknown) => {
      throw prependErrorContext(
        `Failed to ${failureAction} interaction ${target.interactionId}`,
        error,
      );
    });
  return { resolution, updated };
}

function pickApprovalDecision(
  interaction: ApprovalPendingInteraction,
  action: "approve" | "deny",
): PendingInteractionApprovalDecision {
  if (action === "approve") {
    if (interaction.payload.availableDecisions.includes("allow_once")) {
      return "allow_once";
    }
    if (interaction.payload.availableDecisions.includes("allow_for_session")) {
      return "allow_for_session";
    }
    throw new Error(
      `Interaction ${interaction.id} does not offer an approval decision.`,
    );
  }

  if (interaction.payload.availableDecisions.includes("deny")) {
    return "deny";
  }
  throw new Error(
    `Interaction ${interaction.id} does not offer a deny decision.`,
  );
}

function buildBinaryResolution(
  interaction: PendingInteraction,
  action: "approve" | "deny",
): PendingInteractionResolution {
  const approvalInteraction = requireApprovalInteraction(interaction);
  if (
    action === "approve" &&
    approvalInteraction.payload.subject.kind === "permission_grant"
  ) {
    throw new Error(
      `Interaction ${interaction.id} is a permission grant; use bb thread interactions grant.`,
    );
  }
  const decision = pickApprovalDecision(approvalInteraction, action);
  return buildPendingInteractionApprovalResolution(
    approvalInteraction,
    decision,
  );
}

function buildPermissionGrantResolution(
  interaction: PendingInteraction,
  scope: "session" | "turn",
): PendingInteractionResolution {
  const approvalInteraction = requireApprovalInteraction(interaction);
  if (approvalInteraction.payload.subject.kind !== "permission_grant") {
    throw new Error(
      `Interaction ${interaction.id} is ${formatInteractionKind(interaction)} and cannot be granted with this command.`,
    );
  }

  return buildPendingInteractionApprovalResolution(
    approvalInteraction,
    scope === "session" ? "allow_for_session" : "allow_once",
  );
}

function formatBinaryResolutionMessage(
  resolution: PendingInteractionResolution,
): string {
  if (!isApprovalPendingInteractionResolution(resolution)) {
    throw new Error("Expected an approval resolution");
  }
  return formatPendingInteractionApprovalResolutionOutcome(resolution.decision);
}

function formatResolutionSuccessMessage(
  args: ResolveInteractionSuccessMessageArgs,
): string {
  const resolution = args.updated.resolution ?? args.resolution;
  const outcome = formatBinaryResolutionMessage(resolution);
  if (args.updated.status === "resolving") {
    return `Interaction ${args.interactionId} submitted (${outcome}); delivering to provider`;
  }

  return `Interaction ${args.interactionId} ${outcome}`;
}

function formatAnswerResolutionSuccessMessage(
  args: Pick<ResolveInteractionSuccessMessageArgs, "interactionId" | "updated">,
): string {
  if (args.updated.status === "resolving") {
    return `Interaction ${args.interactionId} submitted (answered); delivering to provider`;
  }

  return `Interaction ${args.interactionId} answered`;
}

const INTERACTION_POSITIONALS = [
  { name: "interactionId" },
  OPTIONAL_THREAD_ID,
] as const;

function prepareTarget(
  { positionals, options }: CliValues,
  client: CliClient,
): InteractionTarget {
  return {
    interactionId: optionalString(positionals.interactionId) ?? "",
    id: client.threadId(optionalString(positionals.id), options.self === true),
  };
}

function binaryResolutionCommand(
  name: "approve" | "deny",
  description: string,
): CliCommand {
  return clientCommand<InteractionResolveInput, InteractionResolveOutput>({
    name: `cli.thread.interactions.${name}`,
    kind: "write",
    description: `Read the interaction, then resolve it with its ${name} decision (threads.interaction, threads.resolveInteraction)`,
    door: {
      path: ["thread", "interactions", name],
      summary: description,
      positionals: INTERACTION_POSITIONALS,
      options: [SELF_OPTION],
      prepare: prepareTarget,
      run: (input, client) =>
        resolveInteraction(client, input, name, (interaction) =>
          buildBinaryResolution(interaction, name),
        ),
      json: (output) => output.updated,
      print: (output, input) =>
        formatResolutionSuccessMessage({
          interactionId: input.interactionId,
          ...output,
        }),
    },
  });
}

const listCommand = publicCommand("threads.interactions", {
  path: ["thread", "interactions", "list"],
  summary: "List interactions for a thread",
  positionals: [OPTIONAL_THREAD_ID],
  options: [SELF_OPTION],
  prepare: ({ positionals, options }, client) => ({
    id: client.threadId(optionalString(positionals.id), options.self === true),
  }),
  print: (items) => {
    if (items.length === 0) return "No interactions found";
    printBorderlessTable(
      {
        head: ["ID", "Kind", "Status", "Summary"],
        colWidths: [20, 12, 12, 70],
        trimTrailingWhitespace: true,
      },
      items.map((interaction) => [
        interaction.id,
        formatInteractionKind(interaction),
        interaction.status,
        formatPendingInteractionSummary({ interaction }),
      ]),
    );
    return null;
  },
});

const showCommand = publicCommand("threads.interaction", {
  path: ["thread", "interactions", "show"],
  summary: "Show an interaction",
  positionals: INTERACTION_POSITIONALS,
  options: [SELF_OPTION],
  prepare: prepareTarget,
  print: (interaction) => {
    printInteraction(interaction);
    return null;
  },
});

const grantCommand = clientCommand<
  InteractionResolveInput,
  InteractionResolveOutput
>({
  name: "cli.thread.interactions.grant",
  kind: "write",
  description:
    "Read the permission interaction, then grant it for the turn or session (threads.interaction, threads.resolveInteraction)",
  door: {
    path: ["thread", "interactions", "grant"],
    summary: "Grant a permission interaction",
    positionals: INTERACTION_POSITIONALS,
    options: [
      SELF_OPTION,
      JSON_OPTION,
      flag("--scope <scope>", "Grant scope: turn or session"),
    ],
    prepare: (values, client) => {
      const target = prepareTarget(values, client);
      return {
        ...target,
        scope: parsePermissionGrantScope(optionalString(values.options.scope)),
      };
    },
    run: (input, client) =>
      resolveInteraction(
        client,
        { id: input.id, interactionId: input.interactionId },
        "grant",
        (interaction) =>
          buildPermissionGrantResolution(interaction, input.scope ?? "session"),
      ),
    json: (output) => output.updated,
    print: (output, input) =>
      formatResolutionSuccessMessage({
        interactionId: input.interactionId,
        ...output,
      }),
  },
});

const answerCommand = clientCommand<
  InteractionResolveInput,
  InteractionResolveOutput
>({
  name: "cli.thread.interactions.answer",
  kind: "write",
  description:
    "Read the user-question interaction, then answer it (threads.interaction, threads.resolveInteraction)",
  door: {
    path: ["thread", "interactions", "answer"],
    summary: "Answer a user-question interaction",
    positionals: INTERACTION_POSITIONALS,
    options: [
      SELF_OPTION,
      JSON_OPTION,
      flag(
        "--choice <questionId=value>",
        "Select an option value; repeat for multi-select answers",
        { type: "strings", default: [] },
      ),
      flag("--text <questionId=text>", "Provide a free-text answer", {
        type: "strings",
        default: [],
      }),
    ],
    prepare: (values, client) => ({
      ...prepareTarget(values, client),
      choiceValues: stringList(values.options.choice),
      textValues: stringList(values.options.text),
    }),
    run: (input, client) =>
      resolveInteraction(
        client,
        { id: input.id, interactionId: input.interactionId },
        "answer",
        (interaction) =>
          buildUserAnswerResolution({
            choiceValues: input.choiceValues ?? [],
            interaction,
            textValues: input.textValues ?? [],
          }),
      ),
    json: (output) => output.updated,
    print: (output, input) =>
      formatAnswerResolutionSuccessMessage({
        interactionId: input.interactionId,
        updated: output.updated,
      }),
  },
});

const respondCommand = publicCommand("threads.respondToInteraction", {
  path: ["thread", "interactions", "respond"],
  summary:
    "Answer a plugin form (a plugin's request or a provider's plugin-defined request) with a JSON value",
  positionals: INTERACTION_POSITIONALS,
  options: [
    SELF_OPTION,
    JSON_OPTION,
    flag(
      "--value <json>",
      "The form's answer as JSON, in the shape the plugin's form defines",
      { required: true },
    ),
  ],
  prepare: (values, client) => {
    const target = prepareTarget(values, client);
    return {
      ...target,
      value: parseRespondValue(optionalString(values.options.value) ?? ""),
    };
  },
  failure: (input) => `Failed to respond to interaction ${input.interactionId}`,
  print: (updated, input) =>
    formatAnswerResolutionSuccessMessage({
      interactionId: input.interactionId,
      updated,
    }),
});

export const threadInteractionCommands: CliCommand[] = [
  listCommand,
  showCommand,
  binaryResolutionCommand(
    "approve",
    "Approve a command, file-change, or plan interaction for this turn",
  ),
  grantCommand,
  answerCommand,
  respondCommand,
  binaryResolutionCommand(
    "deny",
    "Deny a command, file-change, plan, or permission interaction",
  ),
];

export function registerInteractionCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const interactions = parent
    .command("interactions")
    .description("Inspect and resolve thread interactions");
  mountCommands(interactions, threadInteractionCommands, { getUrl });
}
