import { describe, expect, it } from "vitest";
import {
  buildExtractCommand,
  detectKicadCli,
  executeExtractCommand,
  parseKicadVersion,
  type HwArtifactKind,
} from "./driver.js";

describe("kicad-cli driver", () => {
  it("parses real version output and degrades truthfully for absent or garbage binaries", async () => {
    expect(parseKicadVersion("8.0.4\n")).toBe("8.0.4");
    expect(parseKicadVersion("KiCad CLI version 9.1.0-rc1")).toBe("9.1.0");
    expect(parseKicadVersion("surprise")).toBeNull();
    await expect(detectKicadCli({ find: async () => null })).resolves.toEqual({
      installed: false, cliPath: null, version: null, supported: false,
    });
    await expect(detectKicadCli({ find: async () => "/bin/kicad-cli", run: async () => "garbage" })).resolves.toEqual({
      installed: true, cliPath: "/bin/kicad-cli", version: null, supported: false,
    });
  });

  it("constructs the required command family and preserves SVG flags", () => {
    const kinds: HwArtifactKind[] = ["sheet_svg", "bom", "netlist", "erc", "board_svg", "glb", "gerber", "drill", "drc"];
    for (const kind of kinds) {
      const command = buildExtractCommand("/opt/kicad-cli", kind, "/work/source", "/work/output");
      expect(command.executable).toBe("/opt/kicad-cli");
      expect(command.args.at(-1)).toBe("/work/source");
      expect(command.args).toContain("/work/output");
    }
    expect(buildExtractCommand("kicad-cli", "sheet_svg", "in", "out").args).toEqual([
      "sch", "export", "svg", "--output", "out", "--no-background-color", "--exclude-drawing-sheet", "in",
    ]);
    expect(buildExtractCommand("kicad-cli", "board_svg", "in", "out").args).toContain("F.Cu,B.Cu,F.Silkscreen,B.Silkscreen,Edge.Cuts");
    expect(buildExtractCommand("kicad-cli", "drc", "in", "out").minMajor).toBe(8);
    expect(buildExtractCommand("kicad-cli", "glb", "in", "out")).toMatchObject({
      args: ["pcb", "export", "glb", "--output", "out", "in"],
      minMajor: 8,
    });
  });

  it("returns nonzero stderr verbatim", async () => {
    const command = buildExtractCommand("kicad-cli", "bom", "in", "out");
    await expect(executeExtractCommand(command, async () => ({ exitCode: 17, stderr: "exact stderr\nline two\n" }))).resolves.toEqual({
      exitCode: 17,
      stderr: "exact stderr\nline two\n",
    });
  });
});
