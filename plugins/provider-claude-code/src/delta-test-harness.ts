import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  clientTurnRequestIdSchema,
  jsonObjectSchema,
  type JsonObject,
  type JsonValue,
  type ThreadEvent,
} from "@bb/domain";
import { z } from "zod";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createClaudeDeltaTranslator,
  type ClaudeDeltaTranslationContext,
  type ClaudeDeltaTranslator,
} from "./delta-translation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "./__fixtures__");

export function loadFixture(name: string): JsonObject {
  const parsed = jsonObjectSchema.safeParse(
    JSON.parse(readFileSync(resolve(FIXTURES, name), "utf8")),
  );
  if (!parsed.success) {
    throw new Error(`Fixture ${name} did not contain an object`);
  }
  return parsed.data;
}

export function loadSessionFixture(name: string): JsonObject[] {
  return readFileSync(resolve(FIXTURES, "sessions", name), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed = jsonObjectSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`Session fixture ${name} contained a non-object line`);
      }
      return parsed.data;
    });
}

type FixtureObject = { [key: string]: JsonValue | undefined };

interface FixtureEnvelope {
  jsonrpc: "2.0";
  method: string;
  params: object;
}

type ClaudeDeltaInput = FixtureObject | FixtureEnvelope;

export function spawningToolUseMessage(args: {
  toolUseId: string;
  toolName: string;
  input?: JsonObject;
  parentToolUseId?: string;
}) {
  return {
    type: "assistant",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: args.toolUseId,
          name: args.toolName,
          input: args.input ?? {},
        },
      ],
    },
    parent_tool_use_id: args.parentToolUseId ?? null,
    session_id: "sess-1",
  };
}

export function spawningToolUseFor(taskStarted: FixtureObject) {
  const toolUseId = z.string().safeParse(taskStarted.tool_use_id);
  if (!toolUseId.success) {
    throw new Error("task_started fixture has no tool_use_id");
  }
  const description = readString(taskStarted.description) ?? "";
  switch (taskStarted.task_type) {
    case "local_workflow":
      return spawningToolUseMessage({
        toolUseId: toolUseId.data,
        toolName: "Workflow",
        input: { script: taskStarted.prompt ?? "" },
      });
    case "local_bash":
      return spawningToolUseMessage({
        toolUseId: toolUseId.data,
        toolName: "Bash",
        input: { command: description, run_in_background: true },
      });
    default:
      const input: JsonObject = {
        description,
        prompt: taskStarted.prompt ?? description,
        run_in_background: true,
      };
      const subagentType = readString(taskStarted.subagent_type);
      if (subagentType !== undefined) input.subagent_type = subagentType;
      return spawningToolUseMessage({
        toolUseId: toolUseId.data,
        toolName: "Agent",
        input,
      });
  }
}

function readString(value: JsonValue | undefined): string | undefined {
  const parsed = z.string().safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

const CLAUDE_TEST_ENTROPY = "cl-test";
export const TURN_1 = "cl-test-t1";
export const TURN_2 = "cl-test-t2";
export const ITEM_ID_PATTERN = /^cl-test-i\d+$/;

interface ClaudeDeltaHarness {
  translator: ClaudeDeltaTranslator;
  translate(
    event: ClaudeDeltaInput,
    context?: ClaudeDeltaTranslationContext,
  ): ThreadEvent[];
  acceptInput(clientRequestId: string, threadId?: string): ThreadEvent[];
  settleSession(threadId?: string): ThreadEvent[];
  itemId(providerItemId: string, threadId?: string): string;
}

export function createClaudeDeltaHarness(): ClaudeDeltaHarness {
  const translator = createClaudeDeltaTranslator({ cwd: "/workspace" });
  const assembler = createDeltaAssembler({
    providerId: "claude-code",
    entropyPrefix: CLAUDE_TEST_ENTROPY,
    textDeltaFlushMs: 0,
  });
  return {
    translator,
    translate(event, context) {
      return assembler.assemble({
        threadId: context?.threadId ?? "",
        // SAFETY: Test fixtures cross the translator's runtime validation boundary here.
        deltas: translator.translate(event as JsonValue, context),
      });
    },
    acceptInput(clientRequestId, threadId = "") {
      return assembler.assemble({
        threadId,
        deltas: translator.acceptInput(
          threadId,
          clientTurnRequestIdSchema.parse(clientRequestId),
        ),
      });
    },
    settleSession(threadId = "") {
      return assembler.assemble({
        threadId,
        deltas: translator.buildSessionSettlementDeltas(threadId),
      });
    },
    itemId(providerItemId, threadId = "") {
      return assembler.getBbItemId(threadId, providerItemId) ?? "";
    },
  };
}
