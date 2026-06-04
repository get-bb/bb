import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME,
  copyApplicationScaffoldTemplate,
  resolveApplicationScaffoldTemplatePath,
} from "../src/services/threads/app-scaffold-template-copy.js";

// Build step: copies the app scaffold template into dist with the same
// dev-artifact exclusions the runtime copy applies, so source/node_modules
// and test output never ship in dist (and downstream bb-app/desktop bundles).
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const targetPath = path.resolve(
  scriptDir,
  "../dist",
  APP_SCAFFOLD_TEMPLATE_DIRECTORY_NAME,
);

const templatePath = resolveApplicationScaffoldTemplatePath();
await rm(targetPath, { force: true, recursive: true });
await copyApplicationScaffoldTemplate({ targetPath, templatePath });
