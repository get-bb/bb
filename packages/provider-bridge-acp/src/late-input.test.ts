import { describe, expect, it } from "vitest";
import { createDeltaAssembler } from "@bb/provider-bridge-protocol/assembler";
import {
  ACP_TURN_STARTED_METHOD,
  ACP_UPDATE_METHOD,
} from "./bridge-protocol.js";
import { createAcpDeltaTranslator } from "./delta-translation.js";

describe.each([
  {
    name: "file read",
    kind: "read",
    input: { path: "lib/entry.ts" },
    title: "entry.ts",
    nextInput: { path: "lib/other.ts" },
    nextTitle: "other.ts",
    completedType: "fileRead",
  },
  {
    name: "path search",
    kind: "search",
    input: { glob: "**/*.spec.ts", path: "/workspace/lib" },
    title: "**/*.spec.ts",
    nextInput: { glob: "**/*.json", path: "/workspace/lib" },
    nextTitle: "**/*.json",
    completedType: "search",
  },
  {
    name: "content search",
    kind: "search",
    input: { pattern: "needle", path: "/workspace/lib" },
    title: "needle",
    nextInput: { pattern: "another needle", path: "/workspace/lib" },
    nextTitle: "another needle",
    completedType: "search",
  },
])("ACP late input: $name", (sample) => {
  it.each([undefined, "partial result"])(
    "refreshes presentation without replacing the running shape (output=%s)",
    (output) => {
      const translator = createAcpDeltaTranslator({ cwd: "/workspace" });
      const assembler = createDeltaAssembler({
        providerId: "acp",
        progressThrottleMs: 0,
      });
      const translate = (update: Record<string, unknown>) =>
        assembler.assemble({
          threadId: "late-input-thread",
          deltas: translator.translateAcpEvent(
            {
              jsonrpc: "2.0",
              method: ACP_UPDATE_METHOD,
              params: { threadId: "late-input-thread", update },
            },
            { threadId: "late-input-thread" },
          ),
        });
      assembler.assemble({
        threadId: "late-input-thread",
        deltas: translator.translateAcpEvent({
          jsonrpc: "2.0",
          method: ACP_TURN_STARTED_METHOD,
          params: { threadId: "late-input-thread" },
        }),
      });
      const initial = translate({
        sessionUpdate: "tool_call",
        toolCallId: "late-input-call",
        kind: sample.kind,
        title: sample.kind,
        status: "pending",
      }).find((event) => event.type === "item/started");
      expect(initial?.item.type).toBe("toolCall");

      const update = {
        sessionUpdate: "tool_call_update",
        toolCallId: "late-input-call",
        status: "in_progress",
        rawInput: sample.input,
      };
      const refreshed = translate({ ...update, rawOutput: output });
      expect(
        refreshed.find((event) => event.type === "item/started"),
      ).toMatchObject({
        item: {
          ...initial?.item,
          presentation: expect.objectContaining({ title: sample.title }),
        },
      });
      if (output !== undefined) {
        expect(refreshed).toContainEqual(
          expect.objectContaining({
            type: "item/toolCall/progress",
            itemId: initial?.item.id,
            message: output,
          }),
        );
      }
      expect(translate(update)).toEqual([]);

      expect(
        translate({ ...update, rawInput: sample.nextInput }).find(
          (event) => event.type === "item/started",
        ),
      ).toMatchObject({
        item: {
          ...initial?.item,
          presentation: expect.objectContaining({ title: sample.nextTitle }),
        },
      });
      const completed = translate({
        sessionUpdate: "tool_call_update",
        toolCallId: "late-input-call",
        status: "completed",
      });
      expect(completed).toEqual(
        ["toolCall", sample.completedType].map((type) =>
          expect.objectContaining({
            type: "item/completed",
            item: expect.objectContaining({
              id: initial?.item.id,
              type,
              presentation: expect.objectContaining({
                title: sample.nextTitle,
              }),
            }),
          }),
        ),
      );
    },
  );
});
