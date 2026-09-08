import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { JsonValue } from "@get-bb/plugin-sdk";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  FULL_PERMISSION_OPTIONS,
  type FakePiBridgeHarness,
  startFakePiBridge,
} from "./test-support.js";

vi.setConfig({ testTimeout: 30_000 });

let harness: FakePiBridgeHarness;
let requestId: number;
let threadId: number;

beforeEach(async () => {
  requestId = 0;
  threadId = 0;
  harness = await startFakePiBridge({
    prefix: "bb-pi-skill-command-",
    initialize: true,
  });
});

afterEach(async () => {
  await harness.teardown();
});

async function promptText(input: JsonValue): Promise<string> {
  threadId += 1;
  const currentThreadId = `thr_skill_command_${threadId}`;
  await harness.startThread(currentThreadId);

  requestId += 1;
  const response = await harness.request(requestId, "turn/start", {
    threadId: currentThreadId,
    providerThreadId: currentThreadId,
    clientRequestId: "creq_ab23456789",
    input,
    options: FULL_PERMISSION_OPTIONS,
  });

  expect(response.error).toBeUndefined();
  await harness.waitForTurnBoundary(currentThreadId);
  return harness
    .deltasOf(currentThreadId)
    .filter((delta) => delta.kind === "item.textDelta")
    .map((delta) => String(delta.text))
    .join("");
}

function selectedSkillMention(
  name: string,
  start: number,
  overrides: { source?: "command" | "skill"; trigger?: string } = {},
) {
  return {
    start,
    end: start + name.length + 1,
    resource: {
      kind: "command" as const,
      trigger: overrides.trigger ?? "/",
      name,
      source: overrides.source ?? ("skill" as const),
      origin: "user" as const,
      label: name,
      argumentHint: null,
    },
  };
}

it("invokes a selected skill through Pi's native command", async () => {
  const output = await promptText([
    {
      type: "text",
      text: "/inspect src",
      mentions: [selectedSkillMention("inspect", 0)],
    },
  ]);

  expect(output).toContain("Response to: /skill:inspect src");
});

it("invokes a selected skill without arguments", async () => {
  const output = await promptText([
    {
      type: "text",
      text: "/inspect",
      mentions: [selectedSkillMention("inspect", 0)],
    },
  ]);

  expect(output).toContain("Response to: /skill:inspect");
});

it("moves a selected skill to Pi's command position and preserves its arguments", async () => {
  const output = await promptText([
    {
      type: "text",
      text: "Please /inspect src",
      mentions: [selectedSkillMention("inspect", "Please ".length)],
    },
  ]);

  expect(output).toContain("Response to: /skill:inspect Please  src");
});

it("preserves argument boundary whitespace", async () => {
  const output = await promptText([
    {
      type: "text",
      text: "  before /inspect after  ",
      mentions: [selectedSkillMention("inspect", "  before ".length)],
    },
  ]);

  expect(output).toContain("Response to: /skill:inspect  before  after  ");
});

it("preserves text chunks, local files, and local images in an invocation turn", async () => {
  const imagePath = join(harness.workspaceDir, "screenshot.png");
  const filePath = join(harness.workspaceDir, "context.txt");
  const promptDumpPath = join(harness.workspaceDir, "prompt.json");
  writeFileSync(imagePath, Buffer.from("fake png data"));
  writeFileSync(filePath, "context");
  vi.stubEnv("FAKE_PI_PROMPT_DUMP", promptDumpPath);
  const output = await promptText([
    { type: "text", text: "Before", mentions: [] },
    { type: "localFile", path: filePath },
    {
      type: "text",
      text: "/inspect after",
      mentions: [selectedSkillMention("inspect", 0)],
    },
    { type: "localImage", path: imagePath },
  ]);

  expect(output).toContain(
    `Response to: /skill:inspect Before\n[Attached file: ${filePath}]\n after`,
  );
  const prompt = JSON.parse(readFileSync(promptDumpPath, "utf8")) as {
    images?: { data: string; mimeType: string; type: string }[];
  };
  expect(prompt.images).toEqual([
    {
      data: Buffer.from("fake png data").toString("base64"),
      mimeType: "image/png",
      type: "image",
    },
  ]);
});

it("keeps multiple selected skills unchanged", async () => {
  const output = await promptText([
    {
      type: "text",
      text: "/inspect then /review",
      mentions: [
        selectedSkillMention("inspect", 0),
        selectedSkillMention("review", "/inspect then ".length),
      ],
    },
  ]);

  expect(output).toContain("Response to: /inspect then /review");
});

it.each([
  {
    name: "empty",
    mention: { ...selectedSkillMention("inspect", 0), end: 0 },
  },
  {
    name: "out-of-bounds",
    mention: { ...selectedSkillMention("inspect", 0), end: 999 },
  },
  {
    name: "text mismatch",
    mention: selectedSkillMention("other", 0),
  },
])("keeps a $name skill mention unchanged", async ({ mention }) => {
  const output = await promptText([
    { type: "text", text: "/inspect src", mentions: [mention] },
  ]);

  expect(output).toContain("Response to: /inspect src");
});

it("rejects negative mention ranges and non-slash triggers at the protocol boundary", async () => {
  const currentThreadId = "thr_invalid_skill_command";
  await harness.startThread(currentThreadId);
  const invalidInputs = [
    {
      type: "text",
      text: "/inspect",
      mentions: [{ ...selectedSkillMention("inspect", 0), start: -1 }],
    },
    {
      type: "text",
      text: "$inspect",
      mentions: [
        {
          ...selectedSkillMention("inspect", 0, { trigger: "$" }),
        },
      ],
    },
  ];

  for (const input of invalidInputs) {
    requestId += 1;
    const response = await harness.request(requestId, "turn/start", {
      threadId: currentThreadId,
      providerThreadId: currentThreadId,
      clientRequestId: "creq_ab23456789",
      input: [input],
      options: FULL_PERMISSION_OPTIONS,
    });
    expect(response.error).toBeDefined();
  }
});

it("keeps selected provider commands and unselected slash text unchanged", async () => {
  const providerCommand = await promptText([
    {
      type: "text",
      text: "/inspect src",
      mentions: [selectedSkillMention("inspect", 0, { source: "command" })],
    },
  ]);
  const rawText = await promptText([
    { type: "text", text: "/inspect src", mentions: [] },
  ]);

  expect(providerCommand).toContain("Response to: /inspect src");
  expect(rawText).toContain("Response to: /inspect src");
});
