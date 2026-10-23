import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { describe, expect, it } from "vitest";

const FORBIDDEN_INPUTS = [
  /(^|\/)packages\/db\//u,
  /(^|\/)node_modules\/(\.pnpm\/)?(drizzle-orm|better-sqlite3|pino)[@/]/u,
  /(^|\/)apps\/server\/src\/(server|start-server)\.ts$/u,
];

describe("terminal relay bundle", () => {
  it("keeps the database, the HTTP app and the logger out of the relay process", async () => {
    const result = await build({
      bundle: true,
      conditions: ["source"],
      entryPoints: [
        fileURLToPath(new URL("../../src/terminal-relay-process.ts", import.meta.url)),
      ],
      format: "esm",
      logLevel: "silent",
      metafile: true,
      platform: "node",
      write: false,
    });
    const inputs = Object.keys(result.metafile.inputs).map((input) =>
      input.replaceAll("\\", "/"),
    );

    expect(inputs.some((input) => input.endsWith("src/terminal-relay-process.ts"))).toBe(
      true,
    );
    expect(
      inputs.filter((input) => FORBIDDEN_INPUTS.some((pattern) => pattern.test(input))),
    ).toEqual([]);
  });
});
