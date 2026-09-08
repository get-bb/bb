import { readFile, readdir } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { isSafeSshDestination } from "bb-machine-ssh/configuration";

export interface SshConfigFileSystem {
  homeDir: string;
  read(path: string): Promise<string>;
  list(path: string): Promise<string[]>;
}

const nodeFileSystem: SshConfigFileSystem = {
  homeDir: homedir(),
  read: (path) => readFile(path, "utf8"),
  list: (path) => readdir(path),
};

function tokens(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const character of line) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (quote !== null) {
      if (character === quote) quote = null;
      else current += character;
    } else if (character === "'" || character === '"') {
      quote = character;
    } else if (character === "#") {
      break;
    } else if (/\s/u.test(character)) {
      if (current.length > 0) {
        result.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current.length > 0) result.push(current);
  return result;
}

function patternRegex(pattern: string): RegExp {
  let expression = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*") expression += ".*";
    else if (character === "?") expression += ".";
    else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end > index + 1) {
        const content = pattern.slice(index + 1, end);
        expression += `[${content.startsWith("!") ? "^" + content.slice(1) : content}]`;
        index = end;
      } else expression += "\\[";
    } else expression += character.replace(/[.+^${}()|\[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${expression}$`, "u");
}

function includePath(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return resolve(homeDir, value.slice(2));
  return isAbsolute(value) ? resolve(value) : resolve(homeDir, ".ssh", value);
}

async function expandInclude(
  value: string,
  fileSystem: SshConfigFileSystem,
): Promise<string[]> {
  const path = includePath(value, fileSystem.homeDir);
  let paths = ["/"];
  for (const segment of path.split("/").filter(Boolean)) {
    const next: string[] = [];
    for (const directory of paths) {
      if (!/[*?[]/u.test(segment)) {
        next.push(join(directory, segment));
        continue;
      }
      const matcher = patternRegex(segment);
      let entries: string[];
      try {
        entries = await fileSystem.list(directory);
      } catch {
        continue;
      }
      for (const name of entries.sort()) {
        if (name.startsWith(".") && !segment.startsWith(".")) continue;
        if (matcher.test(name)) next.push(join(directory, name));
      }
    }
    paths = next;
  }
  return paths;
}

function fieldsForLine(line: string): string[] {
  return tokens(line.replace(/^(\s*[A-Za-z]+)\s*=\s*/u, "$1 "));
}

export function parseSshHostAliases(config: string): string[] {
  const aliases = new Set<string>();
  for (const line of config.split(/\r?\n/u)) {
    const fields = fieldsForLine(line);
    if (fields[0]?.toLowerCase() !== "host") continue;
    for (const alias of fields.slice(1)) {
      if (
        alias.startsWith("!") ||
        alias.includes("*") ||
        alias.includes("?") ||
        !isSafeSshDestination(alias)
      ) {
        continue;
      }
      aliases.add(alias);
    }
  }
  return [...aliases];
}

export async function readSshHostAliases(
  fileSystem: SshConfigFileSystem = nodeFileSystem,
): Promise<string[]> {
  const aliases = new Set<string>();
  const visited = new Set<string>();
  const root = join(fileSystem.homeDir, ".ssh", "config");

  async function visit(path: string): Promise<void> {
    if (visited.has(path)) return;
    visited.add(path);
    let config: string;
    try {
      config = await fileSystem.read(path);
    } catch {
      return;
    }
    for (const alias of parseSshHostAliases(config)) aliases.add(alias);
    for (const line of config.split(/\r?\n/u)) {
      const fields = fieldsForLine(line);
      if (fields[0]?.toLowerCase() !== "include") continue;
      for (const pattern of fields.slice(1)) {
        for (const included of await expandInclude(pattern, fileSystem)) {
          await visit(included);
        }
      }
    }
  }

  await visit(root);
  return [...aliases].sort((left, right) => left.localeCompare(right));
}
