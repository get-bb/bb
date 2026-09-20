import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  HostPlatform,
  ServerMoveServiceManager,
} from "@bb/host-daemon-contract";
import {
  canonicalPath,
  isFileNotFoundError,
  writeFileAtomically,
} from "./fs.js";

export const SERVER_MOVE_SERVICE_MANAGER_ENV = "BB_SERVER_MOVE_SERVICE_MANAGER";

const LAUNCHD_PLIST_PREFIX = "app.getbb.host-daemon.";
const LAUNCHD_PLIST_SUFFIX = ".plist";
const SYSTEMD_USER_UNIT_PREFIX = "bb-host-daemon-";
const SYSTEMD_UNIT_SUFFIX = ".service";
const SERVER_URL_FLAGS = ["--server-url", "--server"] as const;
const LAUNCHER_SUBCOMMANDS = ["host-daemon", "start"] as const;
const HOST_DAEMON_PORT_FLAG = "--host-daemon-port";

export type ServiceDefinitionManager = Exclude<
  ServerMoveServiceManager,
  "none"
>;

type LauncherSubcommand = (typeof LAUNCHER_SUBCOMMANDS)[number];

export interface ServiceDefinition {
  manager: ServiceDefinitionManager;
  path: string;
  unitName: string;
  programArguments: string[];
  environment: Record<string, string>;
  content: string;
}

interface ServiceDefinitionCandidate {
  manager: ServiceDefinitionManager;
  path: string;
}

export interface FindServiceDefinitionArgs {
  dataDir: string;
  homeDir: string;
  platform: HostPlatform;
  env: NodeJS.ProcessEnv;
}

export interface ServerStartArgumentsArgs {
  dataDir: string;
  serverPort: number;
  hostDaemonPort: number;
  bindHost: string | null;
}

interface ParsedServiceDefinition {
  unitName: string;
  programArguments: string[];
  environment: Record<string, string>;
}

async function listMatchingFiles(
  directory: string,
  matches: (name: string) => boolean,
): Promise<string[]> {
  try {
    const names = await readdir(directory);
    return names
      .filter(matches)
      .sort()
      .map((name) => join(directory, name));
  } catch (error) {
    if (isFileNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

async function listServiceDefinitionCandidates(
  args: FindServiceDefinitionArgs,
): Promise<ServiceDefinitionCandidate[]> {
  if (args.platform === "darwin") {
    const paths = await listMatchingFiles(
      join(args.homeDir, "Library", "LaunchAgents"),
      (name) =>
        name.startsWith(LAUNCHD_PLIST_PREFIX) &&
        name.endsWith(LAUNCHD_PLIST_SUFFIX),
    );
    return paths.map((path) => ({ manager: "launchd", path }));
  }
  if (args.platform === "linux" || args.platform === "wsl") {
    const userPaths = await listMatchingFiles(
      join(args.homeDir, ".config", "systemd", "user"),
      (name) =>
        name.startsWith(SYSTEMD_USER_UNIT_PREFIX) &&
        name.endsWith(SYSTEMD_UNIT_SUFFIX),
    );
    const systemPaths = await listMatchingFiles(
      join(args.dataDir, "systemd"),
      (name) => name.endsWith(SYSTEMD_UNIT_SUFFIX),
    );
    return [
      ...userPaths.map((path) => ({
        manager: "systemd-user" as const,
        path,
      })),
      ...systemPaths.map((path) => ({
        manager: "systemd-system" as const,
        path,
      })),
    ];
  }
  return [];
}

export function forcesNoServiceManager(env: NodeJS.ProcessEnv): boolean {
  return env[SERVER_MOVE_SERVICE_MANAGER_ENV] === "none";
}

export async function findServiceDefinition(
  args: FindServiceDefinitionArgs,
): Promise<ServiceDefinition | null> {
  if (forcesNoServiceManager(args.env)) {
    return null;
  }
  const expectedDataDir = await canonicalPath(args.dataDir);
  for (const candidate of await listServiceDefinitionCandidates(args)) {
    let content: string;
    try {
      content = await readFile(candidate.path, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        continue;
      }
      throw error;
    }
    const parsed =
      candidate.manager === "launchd"
        ? parseLaunchdPlist(content)
        : parseSystemdUnit(content, basename(candidate.path));
    const definitionDataDir = parsed?.environment.BB_DATA_DIR;
    if (
      parsed === null ||
      definitionDataDir === undefined ||
      (await canonicalPath(definitionDataDir)) !== expectedDataDir
    ) {
      continue;
    }
    return {
      manager: candidate.manager,
      path: candidate.path,
      unitName: parsed.unitName,
      programArguments: parsed.programArguments,
      environment: parsed.environment,
      content,
    };
  }
  return null;
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/giu, (_match, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/gu, (_match, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">")
    .replace(/&quot;/gu, '"')
    .replace(/&apos;/gu, "'")
    .replace(/&amp;/gu, "&");
}

function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

const LAUNCHD_LABEL_PATTERN =
  /<key>Label<\/key>\s*<string>([\s\S]*?)<\/string>/u;
const LAUNCHD_PROGRAM_ARGUMENTS_PATTERN =
  /<key>ProgramArguments<\/key>\s*<array>([\s\S]*?)<\/array>/u;
const LAUNCHD_ENVIRONMENT_PATTERN =
  /<key>EnvironmentVariables<\/key>\s*<dict>([\s\S]*?)<\/dict>/u;
const XML_STRING_PATTERN = /<string>([\s\S]*?)<\/string>/gu;
const XML_KEY_STRING_PATTERN =
  /<key>([\s\S]*?)<\/key>\s*<string>([\s\S]*?)<\/string>/gu;

export function parseLaunchdPlist(
  content: string,
): ParsedServiceDefinition | null {
  const label = LAUNCHD_LABEL_PATTERN.exec(content)?.[1];
  const programArguments = LAUNCHD_PROGRAM_ARGUMENTS_PATTERN.exec(content)?.[1];
  if (label === undefined || programArguments === undefined) {
    return null;
  }
  const environmentBody = LAUNCHD_ENVIRONMENT_PATTERN.exec(content)?.[1] ?? "";
  const environment: Record<string, string> = {};
  for (const match of environmentBody.matchAll(XML_KEY_STRING_PATTERN)) {
    environment[unescapeXml(match[1] ?? "")] = unescapeXml(match[2] ?? "");
  }
  return {
    unitName: unescapeXml(label),
    programArguments: Array.from(
      programArguments.matchAll(XML_STRING_PATTERN),
      (match) => unescapeXml(match[1] ?? ""),
    ),
    environment,
  };
}

export function formatLaunchdPlist(
  content: string,
  programArguments: readonly string[],
): string {
  const formattedArguments = programArguments
    .map((argument) => `    <string>${escapeXml(argument)}</string>\n`)
    .join("");
  return content.replace(
    LAUNCHD_PROGRAM_ARGUMENTS_PATTERN,
    () =>
      `<key>ProgramArguments</key>\n  <array>\n${formattedArguments}  </array>`,
  );
}

function splitSystemdWords(value: string, unescapeDollar: boolean): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: '"' | "'" | null = null;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (quote !== null) {
      if (character === "\\" && index + 1 < value.length) {
        index += 1;
        current += value[index] ?? "";
        continue;
      }
      if (character === quote) {
        quote = null;
        continue;
      }
      current += character;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      inWord = true;
      continue;
    }
    if (/\s/u.test(character)) {
      if (inWord) {
        words.push(current);
        current = "";
        inWord = false;
      }
      continue;
    }
    if (character === "\\" && index + 1 < value.length) {
      index += 1;
      current += value[index] ?? "";
      inWord = true;
      continue;
    }
    current += character;
    inWord = true;
  }
  if (inWord) {
    words.push(current);
  }
  return words.map((word) => {
    const specifiersUnescaped = word.replace(/%%/gu, "%");
    return unescapeDollar
      ? specifiersUnescaped.replace(/\$\$/gu, "$")
      : specifiersUnescaped;
  });
}

function formatSystemdWord(word: string): string {
  if (/[\u0000\r\n]/u.test(word)) {
    throw new Error(
      "A service argument contains a line break and cannot be written to a systemd unit",
    );
  }
  return `"${word
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/%/gu, "%%")
    .replace(/\$/gu, "$$$$")}"`;
}

function systemdDirective(line: string, name: string): string | null {
  const trimmed = line.trim();
  return trimmed.startsWith(`${name}=`) ? trimmed.slice(name.length + 1) : null;
}

export function parseSystemdUnit(
  content: string,
  unitName: string,
): ParsedServiceDefinition | null {
  let programArguments: string[] | null = null;
  const environment: Record<string, string> = {};
  for (const line of content.split(/\r?\n/u)) {
    const execStart = systemdDirective(line, "ExecStart");
    if (execStart !== null) {
      programArguments = splitSystemdWords(execStart, true);
      continue;
    }
    const environmentValue = systemdDirective(line, "Environment");
    if (environmentValue === null) {
      continue;
    }
    for (const assignment of splitSystemdWords(environmentValue, false)) {
      const separator = assignment.indexOf("=");
      if (separator <= 0) {
        continue;
      }
      environment[assignment.slice(0, separator)] = assignment.slice(
        separator + 1,
      );
    }
  }
  if (programArguments === null) {
    return null;
  }
  return { unitName, programArguments, environment };
}

export function formatSystemdUnit(
  content: string,
  programArguments: readonly string[],
): string {
  return content
    .split("\n")
    .map((line) =>
      systemdDirective(line, "ExecStart") === null
        ? line
        : `ExecStart=${programArguments.map(formatSystemdWord).join(" ")}`,
    )
    .join("\n");
}

function launcherSubcommandIndex(
  programArguments: readonly string[],
): { index: number; subcommand: LauncherSubcommand } | null {
  for (let index = 0; index < programArguments.length; index += 1) {
    const argument = programArguments[index];
    const subcommand = LAUNCHER_SUBCOMMANDS.find(
      (candidate) => candidate === argument,
    );
    if (subcommand !== undefined) {
      return { index, subcommand };
    }
  }
  return null;
}

export function isServerStartDefinition(
  definition: Pick<ServiceDefinition, "programArguments">,
): boolean {
  return (
    launcherSubcommandIndex(definition.programArguments)?.subcommand === "start"
  );
}

export function replaceServerUrlArgument(
  programArguments: readonly string[],
  serverUrl: string,
): string[] {
  const nextArguments = [...programArguments];
  for (let index = 0; index < nextArguments.length; index += 1) {
    const argument = nextArguments[index] ?? "";
    const flag = SERVER_URL_FLAGS.find(
      (candidate) =>
        argument === candidate || argument.startsWith(`${candidate}=`),
    );
    if (flag === undefined) {
      continue;
    }
    if (argument === flag) {
      if (index + 1 < nextArguments.length) {
        nextArguments[index + 1] = serverUrl;
        index += 1;
      }
      continue;
    }
    nextArguments[index] = `${flag}=${serverUrl}`;
  }
  return nextArguments;
}

export function readHostDaemonPortArgument(
  programArguments: readonly string[],
): number | null {
  for (let index = 0; index < programArguments.length; index += 1) {
    const argument = programArguments[index] ?? "";
    const value =
      argument === HOST_DAEMON_PORT_FLAG
        ? programArguments[index + 1]
        : argument.startsWith(`${HOST_DAEMON_PORT_FLAG}=`)
          ? argument.slice(HOST_DAEMON_PORT_FLAG.length + 1)
          : undefined;
    if (value === undefined) {
      continue;
    }
    const port = Number(value);
    if (Number.isInteger(port) && port > 0 && port <= 65_535) {
      return port;
    }
  }
  return null;
}

export function buildServerStartArguments(
  programArguments: readonly string[],
  args: ServerStartArgumentsArgs,
): string[] {
  const subcommand = launcherSubcommandIndex(programArguments);
  if (subcommand === null) {
    throw new Error(
      "The service definition does not run bb-app host-daemon or bb-app start",
    );
  }
  return [
    ...programArguments.slice(0, subcommand.index),
    "start",
    "--data-dir",
    args.dataDir,
    "--server-port",
    String(args.serverPort),
    "--host-daemon-port",
    String(args.hostDaemonPort),
    ...(args.bindHost === null ? [] : ["--server-bind-host", args.bindHost]),
  ];
}

export function formatServiceDefinitionContent(
  definition: Pick<ServiceDefinition, "manager" | "content">,
  programArguments: readonly string[],
): string {
  return definition.manager === "launchd"
    ? formatLaunchdPlist(definition.content, programArguments)
    : formatSystemdUnit(definition.content, programArguments);
}

export async function writeServiceDefinition(
  definition: ServiceDefinition,
  programArguments: readonly string[],
): Promise<ServiceDefinition> {
  const content = formatServiceDefinitionContent(definition, programArguments);
  const mode = (await stat(definition.path)).mode & 0o777;
  await writeFileAtomically({ path: definition.path, content, mode });
  return {
    ...definition,
    programArguments: [...programArguments],
    content,
  };
}
