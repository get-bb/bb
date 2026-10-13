import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { buildPluginServer } from "./build-plugin-server.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

const SERVER_SOURCE = [
  'import { z } from "zod";',
  "const schema = z.object({ email: z.string().email(), age: z.number().int().min(3) });",
  "export const parsed = schema.safeParse({ email: 1, age: 1 });",
  "export const localeNames = Object.keys(z.locales);",
  "export default function plugin() {}",
  "",
].join("\n");

async function buildFixture(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "bb-zod-locale-"));
  tempDirs.push(dir);
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "bb-plugin-zod-locale-fixture",
      version: "0.0.0",
      bb: {
        name: "Zod locale fixture",
        description: "Server entry that parses with zod.",
        branding: { icon: "Zap" },
        server: "./server.ts",
      },
    }),
  );
  await writeFile(join(dir, "server.ts"), SERVER_SOURCE);
  const zodDir = dirname(
    createRequire(
      resolve(import.meta.dirname, "../../plugin-sdk/package.json"),
    ).resolve("zod/package.json"),
  );
  await mkdir(join(dir, "node_modules"), { recursive: true });
  await symlink(zodDir, join(dir, "node_modules", "zod"), "dir");
  const { jsPath } = await buildPluginServer(
    dir,
    "0.0.0-test",
    await resolvePluginBuildToolchain(join(process.cwd(), ".unused-toolchain")),
  );
  return jsPath;
}

it("drops zod's translated locales from a plugin bundle", async () => {
  const bundle = await readFile(await buildFixture(), "utf8");
  expect(bundle).not.toContain("E-Mail-Adresse");
  expect(bundle).not.toContain("Ongeldige invoer");
});

it("leaves parse results and English messages untouched", async () => {
  const module: { parsed: unknown; localeNames: string[] } = await import(
    pathToFileURL(await buildFixture()).href
  );
  const parsed = module.parsed as {
    success: boolean;
    error: { issues: { message: string }[] };
  };
  expect(parsed.success).toBe(false);
  expect(parsed.error.issues.map((issue) => issue.message)).toEqual([
    "Invalid input: expected string, received number",
    "Too small: expected number to be >=3",
  ]);
  expect(module.localeNames).toEqual(["en"]);
});
