import {
  mkdir,
  readdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const templatesDir = path.join(packageRoot, "src", "templates");
const outputPath = path.join(
  packageRoot,
  "src",
  "generated",
  "templates.generated.ts",
);

function asNonEmptyString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function asStringRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([key, rawValue]) => {
      const normalized = asNonEmptyString(rawValue);
      // Strip trailing ? from key for the runtime record (optionality is a type-level concern)
      const cleanKey = key.replace(/\?$/u, "");
      return normalized ? [[cleanKey, normalized]] : [];
    }),
  );
}

/**
 * Parse the variables field from frontmatter, preserving optionality info.
 * Returns an array of { name, description, optional } objects.
 */
function parseVariables(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }

  return Object.entries(value).flatMap(([key, rawValue]) => {
    const description = asNonEmptyString(rawValue);
    if (!description) return [];
    const optional = key.endsWith("?");
    const name = optional ? key.slice(0, -1) : key;
    return [{ name, description, optional }];
  });
}

function toTemplateId(fileName) {
  const baseName = fileName.replace(/\.md$/u, "");
  const segments = baseName.split("-");
  return segments
    .map((segment, index) =>
      index === 0
        ? segment
        : `${segment.slice(0, 1).toUpperCase()}${segment.slice(1)}`,
    )
    .join("");
}

/**
 * Extract variable references from a template body.
 * Returns the set of variable names referenced (excluding partial references).
 */
function extractBodyReferences(body) {
  const references = new Set();

  // Match {{variableName}}, {{{variableName}}}, and {{#if variableName}}
  // but NOT {{> partialName}}, {{/if}}, {{else}}
  const pattern = /\{\{\{?(?:#if\s+)?([a-zA-Z_][a-zA-Z0-9_]*)\}?\}\}/gu;
  let match;
  while ((match = pattern.exec(body)) !== null) {
    references.add(match[1]);
  }

  return references;
}

/**
 * Validate that body references match declared variables.
 * Errors on undeclared references, warns on unreferenced declarations.
 */
function validateVariables(templateId, declaredVars, body) {
  const declaredNames = new Set(declaredVars.map((v) => v.name));
  const bodyRefs = extractBodyReferences(body);
  const errors = [];

  // Check for body references not declared in frontmatter
  for (const ref of bodyRefs) {
    if (!declaredNames.has(ref)) {
      errors.push(
        `Template "${templateId}": body references "{{${ref}}}" but it is not declared in frontmatter variables`,
      );
    }
  }

  // Warn for declared variables not referenced in body
  for (const name of declaredNames) {
    if (!bodyRefs.has(name)) {
      console.warn(
        `Warning: Template "${templateId}": variable "${name}" is declared in frontmatter but not referenced in template body`,
      );
    }
  }

  return errors;
}

const fileNames = (await readdir(templatesDir))
  .filter((fileName) => fileName.endsWith(".md"))
  .sort();

const definitions = [];
const allVariableInfo = [];
const validationErrors = [];

for (const fileName of fileNames) {
  const raw = await readFile(path.join(templatesDir, fileName), "utf8");
  const parsed = matter(raw);
  const kind = asNonEmptyString(parsed.data.kind) ?? "prompt";
  const id = toTemplateId(fileName);
  const variablesParsed = parseVariables(parsed.data.variables);
  const body = parsed.content.trim();

  definitions.push({
    id,
    body,
    fileName,
    kind,
    title: asNonEmptyString(parsed.data.title),
    summary: asNonEmptyString(parsed.data.summary),
    intent: asNonEmptyString(parsed.data.intent),
    editingNotes: asNonEmptyString(parsed.data.editingNotes),
    variables: asStringRecord(parsed.data.variables),
  });

  allVariableInfo.push({ id, variables: variablesParsed });

  // Validate body references against declared variables
  const errors = validateVariables(id, variablesParsed, body);
  validationErrors.push(...errors);
}

if (validationErrors.length > 0) {
  for (const error of validationErrors) {
    console.error(`Error: ${error}`);
  }
  process.exit(1);
}

// Generate TemplateVariables interface
function generateTemplateVariablesInterface(variableInfos) {
  const lines = [];
  lines.push("export interface TemplateVariables {");
  for (const { id, variables } of variableInfos) {
    if (variables.length === 0) {
      lines.push(`  ${id}: Record<string, never>;`);
    } else {
      lines.push(`  ${id}: {`);
      for (const { name, optional } of variables) {
        const optionalMark = optional ? "?" : "";
        lines.push(`    ${name}${optionalMark}: string;`);
      }
      lines.push("  };");
    }
  }
  lines.push("}");
  return lines.join("\n");
}

const templateVariablesBlock =
  generateTemplateVariablesInterface(allVariableInfo);

const output = `/* eslint-disable */
// Generated by packages/templates/scripts/generate-templates.mjs. Do not edit directly.

export const templateDefinitions = ${JSON.stringify(definitions, null, 2)} as const;

${templateVariablesBlock}

export type TemplateId = keyof TemplateVariables;
`;

// Embed @bb/plugin-sdk's bundled .d.ts (committed by that package's build) as
// strings so `bb plugin new` can ship them into a scaffold's types/ dir. Read
// by file path — NOT a package import — to avoid a @bb/templates → @bb/plugin-sdk
// dependency cycle (@bb/sdk already depends on @bb/templates).
const pluginSdkDtsDir = path.join(
  packageRoot,
  "..",
  "plugin-sdk",
  "bundled-types",
);
const pluginSdkDtsOutputPath = path.join(
  packageRoot,
  "src",
  "generated",
  "plugin-sdk-dts.generated.ts",
);
const pluginSdkDts = await readFile(
  path.join(pluginSdkDtsDir, "bb-plugin-sdk.d.ts"),
  "utf8",
);
const pluginSdkAppDts = await readFile(
  path.join(pluginSdkDtsDir, "bb-plugin-sdk-app.d.ts"),
  "utf8",
);
const pluginSdkDtsOutput = `/* eslint-disable */
// Generated by packages/templates/scripts/generate-templates.mjs from
// @bb/plugin-sdk/bundled-types. Do not edit directly.

export const PLUGIN_SDK_DTS = ${JSON.stringify(pluginSdkDts)};

export const PLUGIN_SDK_APP_DTS = ${JSON.stringify(pluginSdkAppDts)};
`;

// Embed the `bb plugin new --app` starter component set from the plugin
// component registry (plugin design §5.5): the transitive closure of the
// starter items, as {target, content} pairs, plus the npm deps a scaffold
// needs to build (dependencies) and typecheck (devDependencies) them —
// versions mirrored from apps/app so vendored source matches what the app
// ships. Read by file path — NOT a package import — same as the plugin-sdk
// dts embed above. Regenerate the registry FIRST
// (node packages/plugin-registry/scripts/build-registry.mjs), then this.
const STARTER_ITEMS = ["button", "card", "input", "dialog"];
// Keep in sync with RUNTIME_SLOT_BY_SPECIFIER in
// packages/plugin-build/src/build-plugin-app.ts: shimmed packages are
// runtime-provided (devDependencies for types only); everything else must be
// a real dependency for esbuild to bundle.
const SHIMMED_SPECIFIERS = new Set([
  "@radix-ui/react-alert-dialog",
  "@radix-ui/react-context-menu",
  "@radix-ui/react-dialog",
  "@radix-ui/react-dropdown-menu",
  "@radix-ui/react-hover-card",
  "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu",
  "@radix-ui/react-popover",
  "@radix-ui/react-select",
  "@radix-ui/react-tooltip",
  "sonner",
  "vaul",
]);
const registryDir = path.join(packageRoot, "..", "plugin-registry", "r");
const appPackageJson = JSON.parse(
  await readFile(
    path.join(packageRoot, "..", "..", "apps", "app", "package.json"),
    "utf8",
  ),
);
const starterFiles = [];
const starterBundledDeps = new Set();
const starterTypeOnlyDeps = new Set();
{
  const seenItems = new Set();
  const itemQueue = [...STARTER_ITEMS];
  while (itemQueue.length > 0) {
    const itemName = itemQueue.pop();
    if (seenItems.has(itemName)) continue;
    seenItems.add(itemName);
    const item = JSON.parse(
      await readFile(path.join(registryDir, `${itemName}.json`), "utf8"),
    );
    for (const file of item.files ?? []) {
      starterFiles.push({ target: file.target, content: file.content });
    }
    for (const dep of item.dependencies ?? []) {
      (SHIMMED_SPECIFIERS.has(dep)
        ? starterTypeOnlyDeps
        : starterBundledDeps
      ).add(dep);
    }
    itemQueue.push(
      ...(item.registryDependencies ?? []).map((name) =>
        name.replace(/^@bb\//, ""),
      ),
    );
  }
}
starterFiles.sort((a, b) => a.target.localeCompare(b.target));
function versionedDeps(names) {
  return Object.fromEntries(
    [...names].sort().map((name) => {
      const version = appPackageJson.dependencies?.[name];
      if (!version) {
        throw new Error(
          `starter dep "${name}" missing from apps/app dependencies`,
        );
      }
      return [name, version];
    }),
  );
}
const starterOutputPath = path.join(
  packageRoot,
  "src",
  "generated",
  "plugin-starter-files.generated.ts",
);
const starterOutput = `/* eslint-disable */
// Generated by packages/templates/scripts/generate-templates.mjs from
// packages/plugin-registry/r (starter items: ${STARTER_ITEMS.join(", ")}).
// Do not edit directly.

export interface PluginStarterFile {
  /** Path relative to the plugin root, e.g. "components/ui/button.tsx". */
  target: string;
  content: string;
}

export const PLUGIN_STARTER_FILES: readonly PluginStarterFile[] = ${JSON.stringify(starterFiles, null, 2)};

/** npm deps \`bb plugin build\` bundles — must be installed to build. */
export const PLUGIN_STARTER_DEPENDENCIES: Readonly<Record<string, string>> = ${JSON.stringify(versionedDeps(starterBundledDeps), null, 2)};

/** Runtime-shimmed packages — installed for editor/tsc types only. */
export const PLUGIN_STARTER_TYPE_DEPENDENCIES: Readonly<Record<string, string>> = ${JSON.stringify(versionedDeps(starterTypeOnlyDeps), null, 2)};
`;

const generatedFiles = [
  { outputPath, content: output },
  { outputPath: pluginSdkDtsOutputPath, content: pluginSdkDtsOutput },
  { outputPath: starterOutputPath, content: starterOutput },
];

if (process.argv.includes("--check")) {
  for (const file of generatedFiles) {
    if ((await readCurrentOutput(file.outputPath)) !== file.content) {
      console.error(
        "Generated templates are out of date. Run `node packages/templates/scripts/generate-templates.mjs`.",
      );
      process.exit(1);
    }
  }
  process.exit(0);
}

for (const file of generatedFiles) {
  await mkdir(path.dirname(file.outputPath), { recursive: true });
  if ((await readCurrentOutput(file.outputPath)) !== file.content) {
    await writeOutputAtomically(file.outputPath, file.content);
  }
}

async function readCurrentOutput(filePath) {
  return readFile(filePath, "utf8").catch((error) => {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ENOENT") {
        return null;
      }
    }
    throw error;
  });
}

async function writeOutputAtomically(filePath, content) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`,
  );

  try {
    await writeFile(temporaryPath, content, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch((unlinkError) => {
      if (
        unlinkError &&
        typeof unlinkError === "object" &&
        "code" in unlinkError &&
        unlinkError.code === "ENOENT"
      ) {
        return;
      }
      throw unlinkError;
    });
    throw error;
  }
}
