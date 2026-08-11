import { describe, expect, it, vi } from "vitest";
import {
  collectLogLines,
  runCommand,
  setupCommandOutputTestEnvironment,
  stubServerApi,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerThreadCommands } from "../../commands/thread/index.js";

const preview = {
  displacedTurnCount: 1,
  eligibility: { status: "eligible" as const },
  mode: "conversation-only" as const,
  provider: "codex" as const,
  revision: 12,
  sourceSequence: 4,
  startsFreshProviderSession: false,
  target: { branchId: "br_root", sourceSequence: 4, turnId: "turn_4" },
};

const commit = {
  draft: null,
  newBranchId: "br_rewind",
  previousBranchId: "br_root",
  requestId: "req_1",
  result: {
    displacedTurnCount: 1,
    mode: "conversation-only" as const,
    previousBranchId: "br_root",
    sourceSequence: 4,
    threadId: "thr_rewind",
  },
  submission: "submitted" as const,
};

describe("bb thread rewind command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerThreadCommands(program, () => "http://server");

  it("previews with explicit target fields and emits JSON", async () => {
    const previewGet = vi.fn(async () => preview);
    stubServerApi({ "v1.threads.:id.rewind.preview.$get": previewGet });

    await runCommand(
      [
        "thread",
        "rewind",
        "thr_rewind",
        "--source-branch",
        "br_root",
        "--source-sequence",
        "4",
        "--turn-id",
        "turn_4",
        "--preview",
        "--json",
      ],
      register,
    );

    expect(previewGet).toHaveBeenCalledWith({
      param: { id: "thr_rewind" },
      query: {
        branchId: "br_root",
        sourceSequence: "4",
        turnId: "turn_4",
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      JSON.stringify(preview, null, 2),
    ]);
  });

  it("previews before committing an explicit replacement prompt", async () => {
    const previewGet = vi.fn(async () => preview);
    const commitPost = vi.fn(async () => commit);
    stubServerApi({
      "v1.threads.:id.rewind.preview.$get": previewGet,
      "v1.threads.:id.rewind.$post": commitPost,
    });

    await runCommand(
      [
        "thread",
        "rewind",
        "thr_rewind",
        "--source-branch",
        "br_root",
        "--source-sequence",
        "4",
        "--turn-id",
        "turn_4",
        "--prompt",
        "Edited prompt",
        "--idempotency-key",
        "rewind-key",
      ],
      register,
    );

    expect(commitPost).toHaveBeenCalledWith({
      param: { id: "thr_rewind" },
      json: {
        editedInput: [{ type: "text", text: "Edited prompt", mentions: [] }],
        idempotencyKey: "rewind-key",
        mode: "conversation-only",
        preview: { revision: 12, target: preview.target },
        target: preview.target,
      },
    });
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      "Thread rewound: thr_rewind",
      "Branch: br_rewind",
      "Submission: submitted",
    ]);
  });

  it("does not commit an ineligible preview", async () => {
    const ineligible = {
      ...preview,
      eligibility: {
        reason: "missing-provider-checkpoint" as const,
        status: "ineligible" as const,
      },
    };
    const previewGet = vi.fn(async () => ineligible);
    const commitPost = vi.fn(async () => commit);
    stubServerApi({
      "v1.threads.:id.rewind.preview.$get": previewGet,
      "v1.threads.:id.rewind.$post": commitPost,
    });

    await expect(
      runCommand(
        [
          "thread",
          "rewind",
          "thr_rewind",
          "--source-branch",
          "br_root",
          "--source-sequence",
          "4",
          "--turn-id",
          "turn_4",
          "--prompt",
          "Edited prompt",
          "--idempotency-key",
          "rewind-key",
          "--json",
        ],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    expect(collectLogLines(vi.mocked(console.log))).toEqual([
      JSON.stringify(
        {
          error: {
            code: "target-ineligible",
            message: "Rewind target is ineligible: missing-provider-checkpoint",
            reason: "missing-provider-checkpoint",
            retryable: false,
          },
          preview: ineligible,
        },
        null,
        2,
      ),
    ]);
    expect(commitPost).not.toHaveBeenCalled();
  });
});
