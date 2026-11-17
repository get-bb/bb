import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { z } from "zod";

const sessionHeaderSchema = z
  .object({
    type: z.literal("session"),
    cwd: z.string(),
  })
  .passthrough();

export function piSessionNeedsRelocation(
  sessionFile: string,
  cwd: string,
): boolean {
  if (!statSync(cwd).isDirectory()) {
    throw new Error(
      `Cannot resume: working directory "${cwd}" is not a directory.`,
    );
  }
  let contents: string;
  try {
    contents = readFileSync(sessionFile, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
  const newline = contents.indexOf("\n");
  const header = sessionHeaderSchema.parse(
    JSON.parse(newline < 0 ? contents : contents.slice(0, newline)),
  );
  return (
    header.cwd !== cwd &&
    !(existsSync(header.cwd) && realpathSync(header.cwd) === realpathSync(cwd))
  );
}

const sessionIdentitySchema = z
  .object({
    type: z.literal("session"),
    id: z.string(),
  })
  .passthrough();

export type PiSessionFileState = "missing" | "valid" | "invalid";

export function readPiSessionFileState(
  sessionFile: string,
): PiSessionFileState {
  let contents: string;
  try {
    contents = readFileSync(sessionFile, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return "missing";
    throw error;
  }
  for (const line of contents.split("\n")) {
    if (!line.trim()) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    return sessionIdentitySchema.safeParse(entry).success ? "valid" : "invalid";
  }
  return contents.length === 0 ? "valid" : "invalid";
}
