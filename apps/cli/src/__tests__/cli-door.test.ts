import { describe, expect, expectTypeOf, it } from "vitest";
import {
  JSON_FLAG_DESCRIPTION,
  YES_FLAG_DESCRIPTION,
  arg,
  flag,
  flagValue,
  mapInput,
  mountedArgs,
  mountedFlags,
  type CliValues,
} from "../cli-door.js";
import { publicCommand } from "../operation-doors.js";

describe("flag and arg specs", () => {
  it("reads the value type, short name, placeholder and negation from the spec", () => {
    expect(flag("-n, --name <label>", "Name")).toEqual({
      flag: "name",
      type: "string",
      description: "Name",
      placeholder: "label",
      short: "n",
    });
    expect(flag("--no-color", "Plain")).toMatchObject({
      flag: "color",
      type: "boolean",
      negatable: true,
    });
    expect(flag("--tag <tag>", "Tag", { type: "strings" }).type).toBe(
      "strings",
    );
    expect(() => flag("--name", "Name", { type: "integer" })).toThrow(
      "--name takes a value",
    );
    expect(() => flag("name", "Name")).toThrow("Unrecognized flag syntax");
    expect(arg("[command...]")).toEqual({
      name: "command",
      required: false,
      variadic: true,
    });
    expect(arg("<id>", "Thread ID")).toMatchObject({
      name: "id",
      required: true,
      description: "Thread ID",
    });
  });

  it("types the values a door reads", () => {
    const positionals = { id: arg("<id>"), rest: arg("[rest...]") };
    const options = {
      title: flag("--title <title>", "Title"),
      size: flag("--size <n>", "Size", { type: "integer", default: 3 }),
      tags: flag("--tag <tag>", "Tag", { type: "strings" }),
      plain: flag("--plain", "Plain"),
    };
    type Values = CliValues<typeof positionals, typeof options>;
    expectTypeOf<Values["positionals"]["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Values["positionals"]["rest"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Values["options"]["title"]>().toEqualTypeOf<
      string | undefined
    >();
    expectTypeOf<Values["options"]["size"]>().toEqualTypeOf<number>();
    expectTypeOf<Values["options"]["tags"]>().toEqualTypeOf<string[]>();
    expectTypeOf<Values["options"]["plain"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Values["options"]>().not.toHaveProperty("titel");
  });
});

describe("mounted flags", () => {
  it("appends --yes for a confirm and --json last unless declared", () => {
    const appended = mountedFlags(
      { scope: flag("--scope <scope>", "Scope") },
      { json: true, confirm: true },
    );
    expect(
      appended.flags.map((entry) => `${entry.flag}: ${entry.description}`),
    ).toEqual([
      "scope: Scope",
      `yes: ${YES_FLAG_DESCRIPTION}`,
      `json: ${JSON_FLAG_DESCRIPTION}`,
    ]);
    const declared = mountedFlags(
      {
        json: flag("--json", "Output JSON"),
        scope: flag("--scope <scope>", "Scope"),
        yes: flag("--yes", "Skip it"),
      },
      { json: true, confirm: false },
    );
    expect(declared.flags.map((entry) => entry.flag)).toEqual([
      "json",
      "scope",
      "yes",
    ]);
    expect(declared.hasYes).toBe(true);
    expect(() =>
      mountedFlags(
        { json: flag("--json <format>", "Format") },
        { json: true, confirm: false },
      ),
    ).toThrow("--json must be declared as a boolean flag");
  });

  it("normalizes raw commander values by type", () => {
    expect(flagValue(flag("--plain", "Plain"), undefined)).toBe(false);
    expect(flagValue(flag("--no-color", "Plain"), undefined)).toBe(true);
    expect(flagValue(flag("--no-color", "Plain"), false)).toBe(false);
    expect(
      flagValue(flag("--tag <tag>", "Tag", { type: "strings" }), undefined),
    ).toEqual([]);
    expect(
      flagValue(flag("--count <n>", "Count", { type: "integer" }), "4"),
    ).toBe(4);
    expect(() =>
      flagValue(flag("--count <n>", "Count", { type: "integer" }), "0"),
    ).toThrow("--count must be a positive integer");
  });
});

describe("default input mapping", () => {
  const args = mountedArgs({ id: arg("[id]"), name: arg("[name]") });
  const { flags } = mountedFlags(
    {
      self: flag("--self", "Self", {
        context: { field: "id", from: "threadId" },
      }),
      title: flag("--title <title>", "Title", { field: "patch.title" }),
      archived: flag("--archived", "Archived"),
      tags: flag("--tag <tag>", "Tag", { type: "strings" }),
    },
    { json: true, confirm: false },
  );

  it("copies values by key and omits absent, false, empty and blank values", () => {
    const resolved: string[] = [];
    const input = mapInput(
      { fixed: { mode: "fast" }, args, flags },
      {
        positionals: { id: "thr_1", name: "" },
        options: {
          self: false,
          title: "Hi",
          archived: false,
          tags: [],
          json: true,
        },
      },
      (field, explicit, requested) => {
        resolved.push(`${field}:${explicit}:${requested}`);
        return explicit ?? "thr_env";
      },
    );
    expect(input).toEqual({
      mode: "fast",
      id: "thr_1",
      patch: { title: "Hi" },
    });
    expect(resolved).toEqual(["threadId:thr_1:false"]);
  });

  it("refuses a command whose keys the operation does not take", () => {
    expect(() =>
      publicCommand("projects.get", {
        path: ["project", "show"],
        summary: "Show",
        positionals: { id: arg("<id>") },
        options: { verbose: flag("--verbose", "More") },
      }),
    ).toThrow(
      "bb project show: projects.get takes no verbose; map it in prepare",
    );
    expect(() =>
      publicCommand("projects.get", {
        path: ["project", "show"],
        summary: "Show",
        positionals: { id: arg("<id>") },
      }),
    ).not.toThrow();
  });
});
