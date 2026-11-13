import { describe, expect, it } from "vitest";
import { parseConductorJson, parseSettingsToml } from "./settings.js";

describe("parseSettingsToml", () => {
  it("reads Conductor's run script and run mode from the scripts table", () => {
    expect(
      parseSettingsToml(
        [
          '"$schema" = "https://conductor.build/schemas/settings.repo.schema.json"',
          "",
          "[scripts]",
          'archive = "./script/workspace-archive.sh"',
          'run = "./script/cond dev"',
          'runMode = "concurrent"',
          "setup = './script/cond setup'",
        ].join("\n"),
      ),
    ).toEqual({ run: "./script/cond dev", runMode: "concurrent" });
  });

  it("ignores a run key outside the scripts table and unsupported multi-line strings", () => {
    expect(
      parseSettingsToml(
        'run = "nope"\n[other]\nrun = "nope"\n[scripts]\nrun = """\nx\n"""',
      ),
    ).toEqual({ run: null, runMode: "nonconcurrent" });
  });

  it("unescapes basic strings and keeps literal strings as written", () => {
    expect(parseSettingsToml('[scripts]\nrun = "echo \\"hi\\""').run).toBe(
      'echo "hi"',
    );
    expect(parseSettingsToml("[scripts]\nrun = 'echo \\n'").run).toBe(
      "echo \\n",
    );
  });
});

describe("parseConductorJson", () => {
  it("reads the legacy conductor.json scripts", () => {
    expect(
      parseConductorJson('{"scripts":{"run":"npm run dev","setup":"npm i"}}'),
    ).toEqual({ run: "npm run dev", runMode: "nonconcurrent" });
  });

  it("treats malformed or empty files as having no run script", () => {
    expect(parseConductorJson("{").run).toBeNull();
    expect(parseConductorJson('{"scripts":{"run":"  "}}').run).toBeNull();
  });
});
