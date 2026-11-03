import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";
import { z } from "zod";

interface FakeGhResponse {
  stdout?: string;
  stderr?: string;
  exit?: number;
  resources?: Record<string, { data: object | null; error?: string }>;
  whenQueryIncludes?: { text: string; response: FakeGhResponse };
}

export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function installFakeGh(
  responses: Record<string, FakeGhResponse>,
): Promise<{
  readCalls(): Promise<string[][]>;
  readQueries(): Promise<string[]>;
}> {
  const binPath = await makeTempDir("bb-fake-gh-");
  const logPath = path.join(binPath, "gh.log");
  const scriptPath = path.join(binPath, "gh.cjs");
  await fs.writeFile(
    scriptPath,
    String.raw`
const fs = require("node:fs");
const args = process.argv.slice(2);
const inputIndex = args.indexOf("--input");
const query = inputIndex === -1 ? null : JSON.parse(fs.readFileSync(args[inputIndex + 1], "utf8")).query;
fs.appendFileSync(process.env.TEST_GH_LOG, JSON.stringify({args, query}) + "\n");
const responses = JSON.parse(process.env.TEST_GH_RESPONSES);
const configured = responses[args.slice(0, 2).join(" ")] ?? {};
const response = configured.whenQueryIncludes && query?.includes(configured.whenQueryIncludes.text) ? configured.whenQueryIncludes.response : configured;
if (response.resources && query) {
  const data = {};
  const errors = [];
  for (const [, alias, encodedUrl] of query.matchAll(/(p\d+): resource\(url: ("(?:\\.|[^"\\])*")\)/g)) {
    const url = JSON.parse(encodedUrl);
    const resource = response.resources[url];
    if (!resource) throw new Error("No fake GraphQL resource for " + url);
    data[alias] = resource.data;
    if (resource.error) errors.push({path: [alias], message: resource.error});
  }
  process.stdout.write(JSON.stringify({data, errors}));
  process.exitCode = response.exit ?? (errors.length > 0 ? 1 : 0);
} else {
  if (response.stdout) process.stdout.write(response.stdout);
  process.exitCode = response.exit ?? 0;
}
if (response.stderr) process.stderr.write(response.stderr);
`,
  );
  const ghPath = path.join(
    binPath,
    process.platform === "win32" ? "gh.cmd" : "gh",
  );
  await fs.writeFile(
    ghPath,
    process.platform === "win32"
      ? `@echo off\r\n"${process.execPath}" "%~dp0gh.cjs" %*\r\n`
      : `#!/bin/sh\nexec '${process.execPath.replaceAll("'", "'\\''")}' '${scriptPath.replaceAll("'", "'\\''")}' "$@"\n`,
    { mode: 0o755 },
  );
  vi.stubEnv("GH_CONFIG_DIR", binPath);
  vi.stubEnv("TEST_GH_LOG", logPath);
  vi.stubEnv("TEST_GH_RESPONSES", JSON.stringify(responses));
  vi.stubEnv("PATH", `${binPath}${path.delimiter}${process.env.PATH ?? ""}`);
  return {
    async readQueries() {
      const lines = (await fs.readFile(logPath, "utf8"))
        .trim()
        .split("\n")
        .filter(Boolean);
      return lines.flatMap((line) => {
        const row = z
          .object({ query: z.string().nullable() })
          .parse(JSON.parse(line));
        return row.query === null ? [] : [row.query];
      });
    },
    async readCalls() {
      try {
        return (await fs.readFile(logPath, "utf8"))
          .trim()
          .split("\n")
          .filter(Boolean)
          .map(
            (line) =>
              z.object({ args: z.array(z.string()) }).parse(JSON.parse(line))
                .args,
          );
      } catch (error) {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          return [];
        }
        throw error;
      }
    },
  };
}
