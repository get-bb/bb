import { readFileSync } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { scaffoldPlugin } from "../src/plugin-scaffold.js";

const execFileAsync = promisify(execFile);
const dependencyRequire = createRequire(
  fileURLToPath(new URL("../../plugin-sdk/package.json", import.meta.url)),
);

const EXTERNAL_DEPENDENCIES = [
  "@hugeicons/core-free-icons",
  "@hugeicons/react",
  "@radix-ui/react-dialog",
  "@radix-ui/react-slot",
  "@types/better-sqlite3",
  "@types/node",
  "@types/react",
  "better-sqlite3",
  "class-variance-authority",
  "clsx",
  "hono",
  "react",
  "tailwind-merge",
  "vaul",
  "zod",
] as const;

const REPRESENTATIVE_SERVER = `
import { defineRpcContract, type BbPluginApi } from "@bb/plugin-sdk";
import { z } from "zod";

export const rpcContract = defineRpcContract({
  projectName: {
    input: z.object({ projectId: z.string() }),
    output: z.object({ name: z.string() }),
  },
});

async function verifyFullSdk(bb: BbPluginApi) {
  const thread = await bb.sdk.threads.spawn({
    projectId: "proj_fixture",
    environment: { type: "project-default" },
    prompt: "Verify the portable SDK contract",
  });
  const threadId: string = thread.id;

  const file = await bb.sdk.files.read({ path: "/tmp/fixture.txt" });
  const sha256: string = file.sha256;

  const project = await bb.sdk.projects.get({ projectId: "proj_fixture" });
  const projectName: string = project.name;
  const sourceId: string | undefined = project.sources[0]?.id;

  const environment = await bb.sdk.environments.status({
    environmentId: "env_fixture",
  });
  const outcome: "available" | "not_applicable" | "unavailable" =
    environment.outcome;

  return { outcome, projectName, sha256, sourceId, threadId };
}

export default function plugin(bb: BbPluginApi) {
  void verifyFullSdk;
  bb.rpc.register(rpcContract, {
    async projectName({ projectId }) {
      const project = await bb.sdk.projects.get({ projectId });
      return { name: project.name };
    },
  });
  bb.log.info("portable SDK fixture loaded");
}
`;

const REPRESENTATIVE_APP = `
import { definePluginApp, useRpc } from "@bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function Panel() {
  const rpc = useRpc<typeof rpcContract>();
  void rpc.call("projectName", { projectId: "proj_fixture" }).then((result) => {
    const exactName: string = result.name;
    void exactName;
  });
  return null;
}

export default definePluginApp((app) => {
  app.slots.homepageSection({ id: "fixture", title: "Fixture", component: Panel });
});
`;

function packageRoot(name: string): string {
  try {
    return dirname(dependencyRequire.resolve(`${name}/package.json`));
  } catch {
    let current = dirname(dependencyRequire.resolve(name));
    while (true) {
      try {
        const manifest = JSON.parse(
          readFileSync(join(current, "package.json"), "utf8"),
        ) as { name?: string };
        if (manifest.name === name) return current;
      } catch {
        // Keep walking to the package root.
      }
      const parent = dirname(current);
      if (parent === current)
        throw new Error(`package root not found: ${name}`);
      current = parent;
    }
  }
}

async function linkExternalDependencies(targetDir: string): Promise<void> {
  for (const name of EXTERNAL_DEPENDENCIES) {
    const target = join(targetDir, "node_modules", name);
    await mkdir(dirname(target), { recursive: true });
    await symlink(packageRoot(name), target, "dir");
  }
}

describe("external plugin scaffold types", () => {
  let workDir: string;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), "bb-external-scaffold-"));
  });

  afterEach(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("typechecks full SDK results without workspace packages and with library checks enabled", async () => {
    const targetDir = join(workDir, "bb-plugin-external");
    await scaffoldPlugin({
      targetDir,
      packageName: "bb-plugin-external",
      bbVersion: "0.9.0",
      app: true,
    });
    await writeFile(join(targetDir, "server.ts"), REPRESENTATIVE_SERVER);
    await writeFile(join(targetDir, "app.tsx"), REPRESENTATIVE_APP);
    await linkExternalDependencies(targetDir);

    const tsconfig = JSON.parse(
      await readFile(join(targetDir, "tsconfig.json"), "utf8"),
    ) as { compilerOptions: { skipLibCheck: boolean } };
    expect(tsconfig.compilerOptions.skipLibCheck).toBe(false);
    await expect(
      access(join(targetDir, "node_modules", "@bb")),
    ).rejects.toThrow();

    const typescriptRoot = packageRoot("typescript");
    let result: { stderr: string; stdout: string };
    try {
      result = await execFileAsync(
        process.execPath,
        [join(typescriptRoot, "lib", "tsc.js"), "--project", "tsconfig.json"],
        { cwd: targetDir },
      );
    } catch (error) {
      const failed = error as { stderr?: string; stdout?: string };
      throw new Error(
        `external scaffold typecheck failed:\n${failed.stdout ?? ""}${failed.stderr ?? ""}`,
      );
    }
    expect(result.stderr).toBe("");
  }, 120_000);
});
