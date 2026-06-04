import { cp } from "node:fs/promises";
import { constants as fsConstants, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Locates and copies the app scaffold template that ships beside this module.
 *
 * This module is shared between the server runtime (app provisioning in
 * ./app-scaffold.ts) and the build step that copies the template into dist
 * (scripts/copy-app-scaffold-template.ts, loaded with tsx before workspace
 * packages are built). Keep it free of workspace and third-party imports.
 */

interface CopyApplicationScaffoldTemplateArgs {
  targetPath: string;
  templatePath: string;
}

interface ResolveApplicationScaffoldTemplatePathArgs {
  moduleDir: string;
}

interface ShouldCopyApplicationScaffoldTemplatePathArgs {
  sourcePath: string;
  templatePath: string;
}

export const APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME = "app-scaffold-template";
export const APP_SCAFFOLD_MANIFEST_FILE_NAME = "manifest.json";
export const APP_SCAFFOLD_README_FILE_NAME = "README.md";
const APP_SCAFFOLD_SOURCE_DIRECTORY_NAME = "source";
const APP_SCAFFOLD_SOURCE_DEV_OUTPUT_DIRECTORY_NAMES = new Set([
  "node_modules",
  "playwright-report",
  "screenshots",
  "test-results",
]);
// Structural essentials the server itself depends on. Template content
// (skills, source files) may change without breaking template detection.
const APP_SCAFFOLD_TEMPLATE_SENTINEL_PATHS = [
  APP_SCAFFOLD_MANIFEST_FILE_NAME,
  APP_SCAFFOLD_README_FILE_NAME,
  path.join("public", "index.html"),
];
const APP_SCAFFOLD_COPY_MODE = fsConstants.COPYFILE_FICLONE;
const scaffoldModuleDir = path.dirname(fileURLToPath(import.meta.url));

function shouldCopyApplicationScaffoldTemplatePath(
  args: ShouldCopyApplicationScaffoldTemplatePathArgs,
): boolean {
  const relativePath = path
    .relative(args.templatePath, args.sourcePath)
    .split(path.sep)
    .join("/");
  if (relativePath === "") {
    return true;
  }
  if (
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    path.isAbsolute(relativePath)
  ) {
    return false;
  }
  const pathSegments = relativePath.split("/");
  if (pathSegments[0] !== APP_SCAFFOLD_SOURCE_DIRECTORY_NAME) {
    return true;
  }
  return !pathSegments.some((segment) =>
    APP_SCAFFOLD_SOURCE_DEV_OUTPUT_DIRECTORY_NAMES.has(segment),
  );
}

function hasApplicationScaffoldTemplate(templatePath: string): boolean {
  return APP_SCAFFOLD_TEMPLATE_SENTINEL_PATHS.every((sentinelPath) =>
    existsSync(path.join(templatePath, sentinelPath)),
  );
}

/**
 * The template directory sits beside this module in both layouts:
 * src/services/threads/ in the source tree, and dist/ in the bundled server
 * (the build copies the template to dist/app-scaffold-template and esbuild
 * bundles this module into the dist entry points).
 */
export function resolveApplicationScaffoldTemplatePathForModuleDir(
  args: ResolveApplicationScaffoldTemplatePathArgs,
): string {
  const templatePath = path.resolve(
    args.moduleDir,
    APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME,
  );
  if (!hasApplicationScaffoldTemplate(templatePath)) {
    throw new Error(`Missing app scaffold template at ${templatePath}`);
  }
  return templatePath;
}

export function resolveApplicationScaffoldTemplatePath(): string {
  return resolveApplicationScaffoldTemplatePathForModuleDir({
    moduleDir: scaffoldModuleDir,
  });
}

/**
 * Copies the template tree, excluding dev artifacts under source/
 * (node_modules, playwright-report, screenshots, test-results) at every depth.
 */
export async function copyApplicationScaffoldTemplate(
  args: CopyApplicationScaffoldTemplateArgs,
): Promise<void> {
  await cp(args.templatePath, args.targetPath, {
    filter: (sourcePath) =>
      shouldCopyApplicationScaffoldTemplatePath({
        sourcePath,
        templatePath: args.templatePath,
      }),
    force: false,
    mode: APP_SCAFFOLD_COPY_MODE,
    recursive: true,
  });
}
