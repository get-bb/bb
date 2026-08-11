import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { codexCompatibility } from "./codex-compatibility.mjs";
import { translateCodexEvent } from "./event-translation.js";
import {
  decodeCodexThreadItem,
  type CodexThreadItem,
} from "./runtime-contracts.js";

type ExpectedOutcome = "ignored" | "unhandled";

interface CompatibilityCase {
  name: string;
  item: unknown;
  expectedItem?: unknown;
  expectedOutcome?: ExpectedOutcome;
}

interface CompatibilityFixture {
  codexVersion: string;
  provenance: string;
  cases: CompatibilityCase[];
}

const generationVersionOutcomes = {
  userMessage: "translated",
  hookPrompt: "unhandled",
  agentMessage: "translated",
  plan: "translated",
  reasoning: "translated",
  commandExecution: "translated",
  fileChange: "translated",
  mcpToolCall: "translated",
  dynamicToolCall: "translated",
  collabAgentToolCall: "translated",
  subAgentActivity: "ignored",
  webSearch: "translated",
  imageView: "translated",
  sleep: "unhandled",
  imageGeneration: "translated",
  enteredReviewMode: "unhandled",
  exitedReviewMode: "unhandled",
  contextCompaction: "translated",
} as const satisfies Record<
  CodexThreadItem["type"],
  "translated" | ExpectedOutcome
>;

const minimumVersionOutcomes = {
  userMessage: "translated",
  hookPrompt: "unhandled",
  agentMessage: "translated",
  plan: "translated",
  reasoning: "translated",
  commandExecution: "translated",
  fileChange: "translated",
  mcpToolCall: "translated",
  dynamicToolCall: "translated",
  collabAgentToolCall: "translated",
  webSearch: "translated",
  imageView: "translated",
  imageGeneration: "translated",
  enteredReviewMode: "unhandled",
  exitedReviewMode: "unhandled",
  contextCompaction: "translated",
} as const;

function readCompatibilityFixture(fileName: string): CompatibilityFixture {
  return JSON.parse(
    readFileSync(
      new URL(`./__fixtures__/${fileName}`, import.meta.url),
      "utf8",
    ),
  );
}

function getItemType(value: unknown): string | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    return null;
  }
  return value.type;
}

function isGenerationItemType(
  value: string,
): value is keyof typeof generationVersionOutcomes {
  return value in generationVersionOutcomes;
}

function isMinimumItemType(
  value: string,
): value is keyof typeof minimumVersionOutcomes {
  return value in minimumVersionOutcomes;
}

function translateFixtureCase(testCase: CompatibilityCase) {
  return translateCodexEvent({
    jsonrpc: "2.0",
    method: "item/completed",
    params: {
      threadId: "compatibility-thread",
      turnId: "compatibility-turn",
      item: testCase.item,
    },
  });
}

describe("decodeCodexThreadItem", () => {
  it("materialises every official default before returning an internal item", () => {
    expect(
      decodeCodexThreadItem({
        type: "reasoning",
        id: "reasoning-defaults-1",
      }),
    ).toEqual({
      type: "reasoning",
      id: "reasoning-defaults-1",
      summary: [],
      content: [],
    });

    expect(
      decodeCodexThreadItem({
        type: "userMessage",
        id: "user-defaults-1",
        content: [
          { type: "text", text: "hello" },
          { type: "image", url: "https://example.test/image.png" },
          { type: "localImage", path: "/tmp/image.png" },
        ],
      }),
    ).toMatchObject({
      content: [
        { type: "text", text: "hello", text_elements: [] },
        {
          type: "image",
          url: "https://example.test/image.png",
          detail: null,
        },
        { type: "localImage", path: "/tmp/image.png", detail: null },
      ],
    });

    expect(
      decodeCodexThreadItem({
        type: "agentMessage",
        id: "agent-defaults-1",
        text: "hello",
      }),
    ).toMatchObject({ memoryCitation: null, phase: null });

    expect(
      decodeCodexThreadItem({
        type: "commandExecution",
        id: "command-defaults-1",
        command: "pwd",
        cwd: "/tmp",
        status: "completed",
        commandActions: [],
      }),
    ).toMatchObject({
      pluginId: null,
      scriptPath: null,
      source: "agent",
    });

    expect(
      decodeCodexThreadItem({
        type: "webSearch",
        id: "web-defaults-1",
        query: "bb",
      }),
    ).toMatchObject({ results: null });
  });

  it("keeps the generation-version matrix exhaustive over the generated union", () => {
    const fixture = readCompatibilityFixture(
      "thread-items-0.147.0-alpha.1.2.json",
    );
    const fixtureTypes = new Set(
      fixture.cases.map(({ item }) => getItemType(item)),
    );

    expect([...fixtureTypes].sort()).toEqual(
      Object.keys(generationVersionOutcomes).sort(),
    );
    for (const testCase of fixture.cases) {
      const itemType = getItemType(testCase.item);
      expect(itemType, testCase.name).not.toBeNull();
      if (!itemType || !isGenerationItemType(itemType)) {
        continue;
      }
      const expectedOutcome = generationVersionOutcomes[itemType];
      expect(
        testCase.expectedItem ? "translated" : testCase.expectedOutcome,
        testCase.name,
      ).toBe(expectedOutcome);
    }
  });

  it("keeps the supported-floor matrix exhaustive over the official 0.136.0 union", () => {
    const fixture = readCompatibilityFixture("thread-items-0.136.0.json");
    const fixtureTypes = new Set(
      fixture.cases.map(({ item }) => getItemType(item)),
    );

    expect([...fixtureTypes].sort()).toEqual(
      Object.keys(minimumVersionOutcomes).sort(),
    );
    for (const testCase of fixture.cases) {
      const itemType = getItemType(testCase.item);
      expect(itemType, testCase.name).not.toBeNull();
      if (!itemType || !isMinimumItemType(itemType)) {
        continue;
      }
      const expectedOutcome = minimumVersionOutcomes[itemType];
      expect(
        testCase.expectedItem ? "translated" : testCase.expectedOutcome,
        testCase.name,
      ).toBe(expectedOutcome);
    }
  });

  it.each([
    ["thread-items-0.136.0.json", codexCompatibility.minimumSupportedVersion],
    [
      "thread-items-0.147.0-alpha.1.2.json",
      codexCompatibility.schemaGenerationVersion,
    ],
  ])(
    "decodes and translates every repository-evidenced case in %s",
    (file, version) => {
      const fixture = readCompatibilityFixture(file);

      expect(fixture.codexVersion).toBe(version);
      expect(fixture.provenance).not.toHaveLength(0);
      for (const testCase of fixture.cases) {
        expect(
          decodeCodexThreadItem(testCase.item),
          testCase.name,
        ).not.toBeNull();

        const events = translateFixtureCase(testCase);
        if (testCase.expectedOutcome === "ignored") {
          expect(events, testCase.name).toEqual([]);
          continue;
        }
        if (testCase.expectedOutcome === "unhandled") {
          expect(events, testCase.name).toContainEqual(
            expect.objectContaining({
              type: "provider/unhandled",
              rawType: "item/completed",
            }),
          );
          continue;
        }

        expect(testCase.expectedItem, testCase.name).toBeDefined();
        expect(events, testCase.name).toContainEqual(
          expect.objectContaining({
            type: "item/completed",
            item: testCase.expectedItem,
          }),
        );
      }
    },
  );

  it("rejects invalid provider data", () => {
    expect(decodeCodexThreadItem({ type: "reasoning", id: 42 })).toBeNull();
  });
});
