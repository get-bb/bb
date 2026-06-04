import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ApplicationId } from "@bb/domain";
import { appManifestSchema, type AppManifest } from "@bb/server-contract";
import {
  APP_SCAFFOLD_MANIFEST_FILE_NAME,
  APP_SCAFFOLD_README_FILE_NAME,
  copyApplicationScaffoldTemplate,
  resolveApplicationScaffoldTemplatePath,
} from "./app-scaffold-template-copy.js";

interface WriteInitialApplicationFilesArgs {
  applicationId: ApplicationId;
  name: string;
  tempRootPath: string;
}

interface PatchApplicationScaffoldReadmeArgs {
  name: string;
  tempRootPath: string;
}

const APP_SCAFFOLD_README_PLACEHOLDER = "BB_APP_NAME_PLACEHOLDER";

function canonicalizeManifestJson(manifest: AppManifest): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

function formatReadmeTitle(name: string): string {
  return name.replace(/\s+/gu, " ").trim();
}

async function patchApplicationScaffoldReadme(
  args: PatchApplicationScaffoldReadmeArgs,
): Promise<void> {
  const readmePath = path.join(args.tempRootPath, APP_SCAFFOLD_README_FILE_NAME);
  const readme = await readFile(readmePath, "utf8");
  const title = formatReadmeTitle(args.name);
  // The replacer function inserts the title literally: app names are user
  // input and may contain `$` patterns that string replacement would expand.
  await writeFile(
    readmePath,
    readme.replaceAll(APP_SCAFFOLD_README_PLACEHOLDER, () => title),
    "utf8",
  );
}

/**
 * Provisions a new app's files inside an unpublished temp root: copies the
 * scaffold template (excluding source/ dev artifacts), writes the manifest,
 * and stamps the app name into the scaffold README.
 */
export async function writeInitialApplicationFiles(
  args: WriteInitialApplicationFilesArgs,
): Promise<void> {
  const manifest: AppManifest = {
    manifestVersion: 1,
    id: args.applicationId,
    name: args.name,
    entry: "index.html",
    capabilities: ["data", "message"],
  };
  const templatePath = resolveApplicationScaffoldTemplatePath();
  await copyApplicationScaffoldTemplate({
    targetPath: args.tempRootPath,
    templatePath,
  });
  const manifestPath = path.join(
    args.tempRootPath,
    APP_SCAFFOLD_MANIFEST_FILE_NAME,
  );
  await writeFile(manifestPath, canonicalizeManifestJson(manifest), "utf8");
  await patchApplicationScaffoldReadme({
    name: args.name,
    tempRootPath: args.tempRootPath,
  });
  appManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}
