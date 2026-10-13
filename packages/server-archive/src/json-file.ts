import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { hasErrorCode } from "./errors.js";

export async function readJsonFileText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

export function parseJsonText(path: string, text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`Invalid JSON at ${path}`, { cause: error });
  }
}

export async function readJsonFile<T extends z.ZodType>(
  path: string,
  schema: T,
): Promise<z.infer<T> | null> {
  const text = await readJsonFileText(path);
  if (text === null) {
    return null;
  }
  const parsed = schema.safeParse(parseJsonText(path, text));
  if (!parsed.success) {
    throw new Error(`Invalid ${path}: ${parsed.error.message}`, {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export async function writeJsonFileAtomically(
  path: string,
  value: unknown,
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tempPath, path);
  } catch (error) {
    await rm(tempPath, { force: true });
    throw error;
  }
}
