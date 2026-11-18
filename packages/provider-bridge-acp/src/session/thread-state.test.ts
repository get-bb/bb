import { EXTENSION_PAYLOAD_MAX_BYTES } from "@bb/domain";
import { describe, expect, it } from "vitest";
import type { AcpAvailableCommand, AcpConfigOption } from "./session-types.js";
import {
  toThreadProviderCommandsState,
  toThreadSessionOptionsState,
} from "./thread-state.js";

function payloadBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function skills(count: number, description: string): AcpAvailableCommand[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `skill-${index}`,
    description: `Skill ${index}: ${description}`,
  }));
}

describe("toThreadProviderCommandsState", () => {
  it("keeps a command list under the limit unchanged", () => {
    const commands: AcpAvailableCommand[] = [
      { name: "review", description: "Review the current diff" },
      { name: "web", description: "Search the web", inputHint: "query" },
    ];

    expect(toThreadProviderCommandsState(commands)).toEqual({
      commands: [
        { name: "review", description: "Review the current diff" },
        { name: "web", description: "Search the web", inputHint: "query" },
      ],
    });
  });

  it("shortens long descriptions so every command fits in one extension payload", () => {
    const commands = skills(300, "x".repeat(600));
    expect(payloadBytes({ commands })).toBeGreaterThan(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );

    const state = toThreadProviderCommandsState(commands);

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    expect(state.commands.map((command) => command.name)).toEqual(
      commands.map((command) => command.name),
    );
    expect(state.commands[0]?.description).toMatch(/^Skill 0: x+…$/u);
    expect(state.commands[0]!.description.length).toBeGreaterThan(100);
  });

  it("keeps short descriptions whole while it shortens long ones", () => {
    const commands = [
      { name: "short", description: "Short description" },
      ...skills(200, "é".repeat(1000)),
    ];

    const state = toThreadProviderCommandsState(commands);

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    expect(state.commands[0]).toEqual({
      name: "short",
      description: "Short description",
    });
    expect(state.commands).toHaveLength(201);
  });

  it("does not split a surrogate pair when it shortens a description", () => {
    const state = toThreadProviderCommandsState(skills(400, "😀".repeat(400)));

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    for (const command of state.commands) {
      expect(command.description).not.toMatch(
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u,
      );
    }
  });

  it("drops trailing commands only when the names alone exceed the limit", () => {
    const commands = Array.from({ length: 500 }, (_, index) => ({
      name: `${"n".repeat(200)}-${index}`,
      description: "d",
    }));

    const state = toThreadProviderCommandsState(commands);

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    expect(state.commands.length).toBeGreaterThan(200);
    expect(state.commands.map((command) => command.name)).toEqual(
      commands.slice(0, state.commands.length).map((command) => command.name),
    );
  });
});

function selectOption(
  id: string,
  valueCount: number,
  valueDescription: string,
): AcpConfigOption {
  return {
    id,
    name: `Option ${id}`,
    description: `Describes ${id}: ${valueDescription}`,
    setMethod: "session/set_config_option",
    type: "select",
    currentValue: "value-0",
    values: Array.from({ length: valueCount }, (_, index) => ({
      value: `value-${index}`,
      name: `Value ${index}`,
      description: valueDescription,
    })),
    groups: [],
  };
}

describe("toThreadSessionOptionsState", () => {
  it("keeps session options under the limit unchanged", () => {
    const state = toThreadSessionOptionsState([
      selectOption("approach", 2, "How the agent works"),
      {
        id: "web",
        name: "Web search",
        setMethod: "session/set_config_option",
        type: "boolean",
        currentValue: false,
      },
    ]);

    expect(state.options[0]).toMatchObject({
      description: "Describes approach: How the agent works",
      values: [
        { id: "value-0", description: "How the agent works" },
        { id: "value-1", description: "How the agent works" },
      ],
    });
    expect(state.options[1]).toEqual({
      id: "web",
      label: "Web search",
      type: "boolean",
      value: false,
    });
  });

  it("shortens long descriptions so every option and value fits in one extension payload", () => {
    const options = Array.from({ length: 10 }, (_, index) =>
      selectOption(`option-${index}`, 100, "y".repeat(300)),
    );

    const state = toThreadSessionOptionsState(options);

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    expect(state.options).toHaveLength(10);
    for (const option of state.options) {
      expect(option.type === "select" && option.values).toHaveLength(100);
    }
    expect(
      state.options[0]?.type === "select" && state.options[0].values[0],
    ).toMatchObject({
      id: "value-0",
      description: expect.stringMatching(/^y+…$/u),
    });
  });

  it("drops trailing options only when they do not fit without descriptions", () => {
    const options = Array.from({ length: 4 }, (_, index) =>
      selectOption(`option-${index}`, 1000, ""),
    );

    const state = toThreadSessionOptionsState(options);

    expect(payloadBytes(state)).toBeLessThanOrEqual(
      EXTENSION_PAYLOAD_MAX_BYTES,
    );
    expect(state.options.length).toBeGreaterThan(0);
    expect(state.options.length).toBeLessThan(4);
    expect(state.options.map((option) => option.id)).toEqual(
      options.slice(0, state.options.length).map((option) => option.id),
    );
  });
});
