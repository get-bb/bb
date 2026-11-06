import { describe, expect, it } from "vitest";
import {
  JSON_FLAG_DESCRIPTION,
  YES_FLAG_DESCRIPTION,
  cliCommandFromDoor,
  type CliDoor,
} from "../src/index.js";

function generate(door: Omit<CliDoor, "path" | "summary">) {
  return cliCommandFromDoor("demo.run", {
    path: ["demo", "run"],
    summary: "Run the demo",
    ...door,
  });
}

function flags(door: Omit<CliDoor, "path" | "summary">) {
  return generate(door).options.map(
    (option) => `${option.flag}: ${option.description}`,
  );
}

describe("cliCommandFromDoor reserved flags", () => {
  const scope = {
    flag: "scope",
    type: "string",
    description: "Scope",
  } as const;

  it("appends --yes for a confirm and --json last when neither is declared", () => {
    expect(flags({ options: [scope], confirm: () => "Sure?" })).toEqual([
      "scope: Scope",
      `yes: ${YES_FLAG_DESCRIPTION}`,
      `json: ${JSON_FLAG_DESCRIPTION}`,
    ]);
  });

  it("keeps the declared position and description of --json and --yes", () => {
    const generated = generate({
      options: [
        { flag: "json", type: "boolean", description: "Output JSON" },
        scope,
        { flag: "yes", type: "boolean", description: "Skip it" },
      ],
      confirm: () => "Sure?",
    });
    expect(
      generated.options.map(
        (option) => `${option.flag}: ${option.description}`,
      ),
    ).toEqual(["json: Output JSON", "scope: Scope", "yes: Skip it"]);
    expect(generated.hasJson).toBe(true);
    expect(generated.hasYes).toBe(true);
  });

  it("treats a declared --yes as the confirmation flag without a door confirm", () => {
    expect(
      generate({
        options: [{ flag: "yes", type: "boolean", description: "Skip it" }],
      }).hasYes,
    ).toBe(true);
    expect(generate({ options: [scope] }).hasYes).toBe(false);
  });

  it("leaves a declared --json as a plain flag when the door prints its own output", () => {
    const generated = generate({
      noJson: true,
      options: [{ flag: "json", type: "boolean", description: "Raw" }],
    });
    expect(generated.hasJson).toBe(false);
    expect(generated.options.map((option) => option.flag)).toEqual(["json"]);
  });

  it("rejects a reserved flag declared with a value", () => {
    expect(() =>
      generate({ options: [{ flag: "yes", type: "string", description: "" }] }),
    ).toThrow("--yes must be declared as a boolean flag");
  });
});

describe("cliCommandFromDoor output", () => {
  it("joins printed lines for text renderers and keeps them for the mount", () => {
    const generated = generate({ print: () => ["one", "two"] });
    expect(generated.print(null, {})).toEqual(["one", "two"]);
    expect(generated.render(null, {}, false)).toBe("one\ntwo");
    expect(generated.render({ ok: true }, {}, true)).toBe(
      JSON.stringify({ ok: true }, null, 2),
    );
  });

  it("passes whether --json was given to exitCode", () => {
    const generated = generate({
      exitCode: (_output, _input, json) => (json ? 0 : 1),
    });
    expect(generated.exitCode(null, {}, false)).toBe(1);
    expect(generated.exitCode(null, {}, true)).toBe(0);
  });
});
