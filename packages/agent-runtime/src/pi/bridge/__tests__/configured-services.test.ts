import { afterEach, describe, expect, it } from "vitest";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConfiguredPiServices } from "../configured-services.js";

const testRoots: string[] = [];

async function createTestDirs(): Promise<{
  agentDir: string;
  cwd: string;
  markerPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "bb-pi-services-test-"));
  testRoots.push(root);
  const agentDir = join(root, "agent");
  const cwd = join(root, "workspace");
  const markerPath = join(root, "extension-marker.txt");
  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await mkdir(agentDir, { recursive: true });
  await writeFile(
    join(cwd, ".pi", "settings.json"),
    JSON.stringify({ extensions: ["./extensions/marker.ts"] }),
  );
  await writeFile(
    join(cwd, ".pi", "extensions", "marker.ts"),
    `import { writeFileSync } from "node:fs";
export default function extension(): void {
  writeFileSync(${JSON.stringify(markerPath)}, "loaded", "utf8");
}
`,
  );
  return { agentDir, cwd, markerPath };
}

async function markerWasWritten(markerPath: string): Promise<boolean> {
  try {
    return (await readFile(markerPath, "utf8")) === "loaded";
  } catch {
    return false;
  }
}

afterEach(async () => {
  await Promise.all(
    testRoots.splice(0).map((root) => rm(root, { recursive: true })),
  );
});

describe("configured Pi services", () => {
  it.each([
    {
      name: "keeps an unresolved project untrusted",
      defaultProjectTrust: "ask" as const,
      savedDecision: undefined,
      trusted: false,
    },
    {
      name: "keeps a saved rejection untrusted",
      defaultProjectTrust: "always" as const,
      savedDecision: false,
      trusted: false,
    },
    {
      name: "loads resources for a saved trust decision",
      defaultProjectTrust: "ask" as const,
      savedDecision: true,
      trusted: true,
    },
    {
      name: "loads resources under the global always policy",
      defaultProjectTrust: "always" as const,
      savedDecision: undefined,
      trusted: true,
    },
  ])("$name", async ({ defaultProjectTrust, savedDecision, trusted }) => {
    const { agentDir, cwd, markerPath } = await createTestDirs();
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultProjectTrust }),
    );
    if (savedDecision !== undefined) {
      const canonicalCwd = await realpath(cwd);
      await writeFile(
        join(agentDir, "trust.json"),
        JSON.stringify({ [canonicalCwd]: savedDecision }),
      );
    }

    const services = await createConfiguredPiServices({ agentDir, cwd });

    expect(services.settingsManager.isProjectTrusted()).toBe(trusted);
    expect(await markerWasWritten(markerPath)).toBe(trusted);
  });

  it("reports a broken extension from the shared service path", async () => {
    const { agentDir, cwd } = await createTestDirs();
    await writeFile(
      join(agentDir, "settings.json"),
      JSON.stringify({ defaultProjectTrust: "always" }),
    );
    await writeFile(
      join(cwd, ".pi", "extensions", "marker.ts"),
      "export default function extension( { this is invalid",
    );

    await expect(createConfiguredPiServices({ agentDir, cwd })).rejects.toThrow(
      "Failed to load Pi extension",
    );
  });
});
