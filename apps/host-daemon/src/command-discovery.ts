import path from "node:path";
import {
  firstPerIdentity,
  scanSkillFiles,
  skillRegistrationId,
  type IndexedSkillFile,
} from "@bb/skill-index";
import {
  parseSkillMetadata,
  type SkillMetadata,
} from "@bb/skill-index/metadata";
import type {
  DiscoveredSkill,
  HostCommandOrigin,
  HostCommandSource,
  HostProviderCommand,
  SkillRootKind,
} from "@bb/host-daemon-contract";
export { SKILL_FILE_NAME } from "@bb/skill-index";

interface CommandScanRootBase {
  boundaryPath?: string;
  namePrefix: string;
  skipIfManifest?: string;
  source: HostCommandSource;
  origin: HostCommandOrigin;
  skillIdentitySeed?: string;
}

interface CommandScanDirectoryRoot extends CommandScanRootBase {
  rootPath: string;
  shape: "skill" | "skill-recursive" | "skill-directory" | "command";
}

interface CommandScanFileRoot extends CommandScanRootBase {
  filePath: string;
  shape: "command-file";
}

interface CommandScanSkillFileRoot extends CommandScanRootBase {
  fallbackName: string;
  filePath: string;
  shape: "skill-file";
  source: "skill";
}

export type CommandScanRoot =
  | CommandScanDirectoryRoot
  | CommandScanFileRoot
  | CommandScanSkillFileRoot;

async function scanRoot(
  root: CommandScanRoot,
): Promise<Array<IndexedSkillFile & { metadata: SkillMetadata }>> {
  const files = await scanSkillFiles({
    path: "rootPath" in root ? root.rootPath : root.filePath,
    shape: root.shape,
    boundaryPath:
      root.origin === "project"
        ? (root.boundaryPath ??
          ("rootPath" in root ? root.rootPath : path.dirname(root.filePath)))
        : null,
    ...(root.skipIfManifest === undefined
      ? {}
      : { skipIfManifest: root.skipIfManifest }),
    ...(root.shape === "skill-file" ? { fallbackName: root.fallbackName } : {}),
  });
  return files.map((file) => {
    const metadata = parseSkillMetadata(file.content);
    return {
      ...file,
      name:
        root.shape === "skill-file" ? (metadata.name ?? file.name) : file.name,
      metadata,
    };
  });
}

export async function discoverProviderCommands(args: {
  roots: readonly CommandScanRoot[];
}): Promise<HostProviderCommand[]> {
  const records: Array<{ command: HostProviderCommand; identity: string }> = [];
  for (const root of args.roots) {
    for (const match of await scanRoot(root)) {
      records.push({
        identity: `${root.source}\0${root.namePrefix}${match.name}\0${root.source === "skill" ? match.contentSha256 : match.realPath}`,
        command: {
          name: `${root.namePrefix}${match.name}`,
          source: root.source,
          origin: root.origin,
          description: match.metadata.description,
          argumentHint: match.metadata.argumentHint,
        },
      });
    }
  }
  return firstPerIdentity(records, (record) => record.identity).map(
    (record) => record.command,
  );
}

export type SkillScanRoot = CommandScanRoot & {
  identitySeed: string;
  rootKind: SkillRootKind;
};

export async function discoverSkills(args: {
  roots: readonly SkillScanRoot[];
}): Promise<DiscoveredSkill[]> {
  const records: DiscoveredSkill[] = [];
  for (const root of args.roots) {
    if (root.source !== "skill") continue;
    const rootPath =
      "rootPath" in root ? root.rootPath : path.dirname(root.filePath);
    for (const match of await scanRoot(root)) {
      const logicalPath = path
        .relative(rootPath, match.filePath)
        .split(path.sep)
        .join("/");
      records.push({
        id: skillRegistrationId(root.identitySeed, logicalPath),
        name: `${root.namePrefix}${match.name}`,
        description: match.metadata.description,
        filePath: match.filePath,
        realPath: match.realPath,
        contentSha256: match.contentSha256,
        rootKind: root.rootKind,
        linked: match.linked,
      });
    }
  }
  return records;
}
