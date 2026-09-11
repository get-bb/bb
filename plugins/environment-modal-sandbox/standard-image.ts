import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

export async function readStandardDockerfile() {
  return readFile(new URL("./Dockerfile", import.meta.url), "utf8").catch(
    async (error: unknown) => {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
      return readFile(new URL("../Dockerfile", import.meta.url), "utf8");
    },
  );
}

export async function readStandardImage(override?: string) {
  const dockerfile = override ?? (await readStandardDockerfile());
  const lines = dockerfile
    .replace(/\\\r?\n/g, " ")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const from = /^FROM (\S+)$/.exec(lines[0] ?? "");
  if (
    !from ||
    lines.slice(1).some((line) => !/^(RUN|ENV|WORKDIR|USER) /.test(line))
  )
    throw new Error(
      "The Modal Dockerfile requires one FROM followed by RUN, ENV, WORKDIR or USER instructions",
    );
  return {
    reference: from[1]!,
    commands: lines.slice(1),
    name: `bb-standard:${createHash("sha256").update(dockerfile).digest("hex")}`,
  };
}
