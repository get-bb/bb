/**
 * Shared equivalence harness for the ported claude translation suites: the
 * SAME claude SDK fixtures drive the new pipeline — claude dialect events →
 * semantic deltas → a real runtime delta assembler → canonical ThreadEvents.
 * Ids are asserted by shape and via the assembler's provider↔bb maps because
 * minting moved from the bridge to the assembler (thread/provider thread ids
 * are stamped downstream by the runtime, so events leave with empty ids).
 *
 * Test-only: not part of the plugin build (imported by *.test.ts only).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientTurnRequestId, ThreadEvent } from "@bb/domain";
import { experimental_createDeltaAssembler as createDeltaAssembler } from "@get-bb/plugin-sdk/provider-bridge/testing";
import {
  createClaudeDeltaTranslator,
  type ClaudeDeltaTranslationContext,
  type ClaudeDeltaTranslator,
} from "./delta-translation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(__dirname, "./__fixtures__");

function isFixtureObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function loadFixture(name: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(
    readFileSync(resolve(FIXTURES, name), "utf8"),
  );
  if (!isFixtureObject(parsed)) {
    throw new Error(`Fixture ${name} did not contain an object`);
  }
  return parsed;
}

export function loadSessionFixture(name: string): Record<string, unknown>[] {
  return readFileSync(resolve(FIXTURES, "sessions", name), "utf8")
    .trim()
    .split("\n")
    .map((line) => {
      const parsed: unknown = JSON.parse(line);
      if (!isFixtureObject(parsed)) {
        throw new Error(`Session fixture ${name} contained a non-object line`);
      }
      return parsed;
    });
}

const CLAUDE_TEST_ENTROPY = "cl-test";
export const TURN_1 = "cl-test-t1";
export const TURN_2 = "cl-test-t2";
export const ITEM_ID_PATTERN = /^cl-test-i\d+$/;

interface ClaudeDeltaHarness {
  translator: ClaudeDeltaTranslator;
  translate(
    event: unknown,
    context?: ClaudeDeltaTranslationContext,
  ): ThreadEvent[];
  acceptInput(clientRequestId: string, threadId?: string): ThreadEvent[];
  /** The bridge's session-death settlement (interrupt/replace/exit). */
  settleSession(threadId?: string): ThreadEvent[];
  /** bb item id minted for a claude-native id (empty when never seen). */
  itemId(providerItemId: string, threadId?: string): string;
}

export function createClaudeDeltaHarness(): ClaudeDeltaHarness {
  const translator = createClaudeDeltaTranslator();
  const assembler = createDeltaAssembler({
    providerId: "claude-code",
    entropyPrefix: CLAUDE_TEST_ENTROPY,
    // Equivalence suites pin per-delta translation fidelity: no coalescing.
    textDeltaFlushMs: 0,
  });
  return {
    translator,
    translate(event, context) {
      return assembler.assemble({
        threadId: context?.threadId ?? "",
        deltas: translator.translate(event, context),
      });
    },
    acceptInput(clientRequestId, threadId = "") {
      return assembler.assemble({
        threadId,
        deltas: translator.acceptInput(
          threadId,
          clientRequestId as ClientTurnRequestId,
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
