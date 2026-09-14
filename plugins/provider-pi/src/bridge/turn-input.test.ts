import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  turnStartParamsSchema,
  type PromptInput,
} from "@get-bb/plugin-sdk/provider-bridge";
import { expect, it } from "vitest";
import { extractPiPromptInput } from "./turn-input.js";

function selectedSkillMention(
  name: string,
  start: number,
  source: "command" | "skill" = "skill",
) {
  return {
    start,
    end: start + name.length + 1,
    resource: {
      kind: "command" as const,
      trigger: "/" as const,
      name,
      source,
      origin: "user" as const,
      label: name,
      argumentHint: null,
    },
  };
}

function extractText(input: PromptInput[]): string | undefined {
  return extractPiPromptInput(input).text;
}

it("preserves local file paths with and without text", () => {
  const path = "/workspace/notes.md";
  const marker = `[Attached file: ${path}]`;
  const file = {
    type: "localFile" as const,
    path,
    name: "notes.md",
    sizeBytes: 6,
    mimeType: "text/markdown",
  };

  expect(
    extractText([
      { type: "text", text: "Read this file.", mentions: [] },
      file,
    ]),
  ).toBe(`Read this file.\n${marker}`);
  expect(extractText([file])).toBe(marker);
});

it("invokes a selected skill through Pi's native command", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "/inspect src",
        mentions: [selectedSkillMention("inspect", 0)],
      },
    ]),
  ).toBe("/skill:inspect src");
});

it("invokes a selected skill without arguments", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "/inspect",
        mentions: [selectedSkillMention("inspect", 0)],
      },
    ]),
  ).toBe("/skill:inspect");
});

it("moves a selected skill to Pi's command position and preserves its arguments", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "Please /inspect src",
        mentions: [selectedSkillMention("inspect", "Please ".length)],
      },
    ]),
  ).toBe("/skill:inspect Please  src");
});

it("preserves argument boundary whitespace", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "  before /inspect after  ",
        mentions: [selectedSkillMention("inspect", "  before ".length)],
      },
    ]),
  ).toBe("/skill:inspect  before  after  ");
});

it("preserves text chunks, local files, and local images", () => {
  const workspaceDir = mkdtempSync(join(tmpdir(), "bb-pi-turn-input-"));
  try {
    const imagePath = join(workspaceDir, "screenshot.png");
    const filePath = join(workspaceDir, "context.txt");
    writeFileSync(imagePath, Buffer.from("fake png data"));
    const extracted = extractPiPromptInput([
      { type: "text", text: "Before", mentions: [] },
      { type: "localFile", path: filePath },
      {
        type: "text",
        text: "/inspect after",
        mentions: [selectedSkillMention("inspect", 0)],
      },
      { type: "localImage", path: imagePath },
    ]);

    expect(extracted).toEqual({
      text: `/skill:inspect Before\n[Attached file: ${filePath}]\n after`,
      images: [
        {
          data: Buffer.from("fake png data").toString("base64"),
          mimeType: "image/png",
          type: "image",
        },
      ],
    });
  } finally {
    rmSync(workspaceDir, { recursive: true, force: true });
  }
});

it("keeps multiple selected skills unchanged", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "/inspect then /review",
        mentions: [
          selectedSkillMention("inspect", 0),
          selectedSkillMention("review", "/inspect then ".length),
        ],
      },
    ]),
  ).toBe("/inspect then /review");
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
])("keeps a $name skill mention unchanged", ({ mention }) => {
  expect(
    extractText([{ type: "text", text: "/inspect src", mentions: [mention] }]),
  ).toBe("/inspect src");
});

it("keeps selected provider commands and unselected slash text unchanged", () => {
  expect(
    extractText([
      {
        type: "text",
        text: "/inspect src",
        mentions: [selectedSkillMention("inspect", 0, "command")],
      },
    ]),
  ).toBe("/inspect src");
  expect(
    extractText([{ type: "text", text: "/inspect src", mentions: [] }]),
  ).toBe("/inspect src");
});

it("rejects invalid skill mentions at the protocol boundary", () => {
  const validMention = selectedSkillMention("inspect", 0);
  const invalidInputs = [
    {
      type: "text",
      text: "/inspect",
      mentions: [{ ...validMention, start: -1 }],
    },
    {
      type: "text",
      text: "$inspect",
      mentions: [
        {
          ...validMention,
          resource: { ...validMention.resource, trigger: "$" },
        },
      ],
    },
  ];

  for (const input of invalidInputs) {
    expect(
      turnStartParamsSchema.safeParse({
        threadId: "thr_skill_command",
        providerThreadId: "thr_skill_command",
        clientRequestId: "creq_ab23456789",
        input: [input],
        options: {
          permissionMode: "full",
          permissionScope: "full",
          approvalReviewer: null,
          permissionEscalation: null,
        },
      }).success,
    ).toBe(false);
  }
});
