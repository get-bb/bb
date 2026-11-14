import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const PACKAGE_NAME = "@get-bb/plugin-sdk";
const HIDDEN_NAME = /^(?:InternalDoNotUse|internal_DO_NOT_USE_)/u;
const LINE_WIDTH = 100;

export const API_INDEX_FILES = [
  {
    filename: "frontend-api-index.md",
    title: "Frontend API symbol index",
    intro: [
      "Use this index to check public imports from `@get-bb/plugin-sdk/app`.",
      "Read the other frontend references for behavior, fields, and examples.",
      "Read the installed SDK declarations for the exact current signatures.",
    ],
    entries: [{ subpath: "./app" }],
  },
  {
    filename: "backend-api-index.md",
    title: "Backend API symbol index",
    intro: [
      "Check imports here, behavior in the Plugin Guide, and signatures in the installed declarations.",
    ],
    entries: [
      { subpath: "." },
      { subpath: "./environment-provider" },
      { subpath: "./machine-provider" },
      { subpath: "./host" },
      { subpath: "./process" },
      { subpath: "./testing" },
      { subpath: "./testing/host" },
    ],
  },
  {
    filename: "frontend-testing-api-index.md",
    title: "Frontend testing API symbol index",
    intro: [
      "Use this index to check `app.tsx` test imports; backend-api-index.md lists",
      "the backend and host-entry test entrypoints.",
      "Read `testing.md` for examples and fidelity limits.",
    ],
    entries: [{ subpath: "./testing/app" }],
  },
  {
    filename: "provider-bridge-api-index.md",
    title: "Provider bridge API symbol index",
    intro: [
      "Use this index to check provider bridge imports.",
      "Read `providers.md` and the provider docs it links for behavior and examples.",
      "Read the installed declarations for exact current signatures.",
    ],
    entries: [
      { subpath: "./provider-bridge" },
      { subpath: "./provider-bridge/testing" },
      { subpath: "./provider-bridge/acp" },
      {
        subpath: "./provider-bridge/acp-next",
        note: [
          "Deprecated. The same exports as `provider-bridge/acp`, kept so plugins that",
          "imported the preview name keep building.",
        ],
      },
    ],
  },
];

function resolveRelativeModule(fromFile, specifier) {
  const base = path.resolve(
    path.dirname(fromFile),
    specifier.replace(/\.js$/u, ""),
  );
  const candidates = [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (resolved === undefined) {
    throw new Error(`${fromFile}: cannot resolve "${specifier}"`);
  }
  return resolved;
}

function hasModifier(node, kind) {
  return (
    ts.canHaveModifiers(node) &&
    (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
  );
}

function isInternal(statement) {
  return ts
    .getJSDocTags(statement)
    .some((tag) => tag.tagName.text === "internal");
}

function record(target, name, kind) {
  if (target.get(name) !== "value") target.set(name, kind);
}

function declaredNames(statement) {
  if (
    ts.isFunctionDeclaration(statement) ||
    ts.isClassDeclaration(statement) ||
    ts.isEnumDeclaration(statement) ||
    ts.isModuleDeclaration(statement)
  ) {
    return statement.name !== undefined && ts.isIdentifier(statement.name)
      ? [[statement.name.text, "value"]]
      : [];
  }
  if (
    ts.isInterfaceDeclaration(statement) ||
    ts.isTypeAliasDeclaration(statement)
  ) {
    return [[statement.name.text, "type"]];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name)
        ? [[declaration.name.text, "value"]]
        : [],
    );
  }
  return [];
}

function importedNames(statement, file, cache) {
  const clause = statement.importClause;
  if (clause === undefined) return [];
  const specifier = statement.moduleSpecifier.text;
  const isRelative = specifier.startsWith(".");
  const names = [];
  if (clause.name !== undefined) {
    names.push([clause.name.text, clause.isTypeOnly ? "type" : "value"]);
  }
  const bindings = clause.namedBindings;
  if (bindings === undefined) return names;
  if (ts.isNamespaceImport(bindings)) {
    names.push([bindings.name.text, clause.isTypeOnly ? "type" : "value"]);
    return names;
  }
  for (const element of bindings.elements) {
    if (clause.isTypeOnly || element.isTypeOnly) {
      names.push([element.name.text, "type"]);
      continue;
    }
    if (!isRelative) {
      names.push([element.name.text, "value"]);
      continue;
    }
    const target = moduleExports(resolveRelativeModule(file, specifier), cache);
    const original = (element.propertyName ?? element.name).text;
    names.push([element.name.text, target.get(original) ?? "value"]);
  }
  return names;
}

function moduleExports(file, cache) {
  const cached = cache.get(file);
  if (cached !== undefined) return cached;
  const exports = new Map();
  cache.set(file, exports);
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.ESNext,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const locals = new Map();
  for (const statement of source.statements) {
    if (ts.isImportDeclaration(statement)) {
      for (const [name, kind] of importedNames(statement, file, cache)) {
        record(locals, name, kind);
      }
      continue;
    }
    for (const [name, kind] of declaredNames(statement)) {
      record(locals, name, kind);
    }
  }
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier?.text;
      const clause = statement.exportClause;
      if (clause === undefined || ts.isNamespaceExport(clause)) {
        if (clause !== undefined) {
          record(
            exports,
            clause.name.text,
            statement.isTypeOnly ? "type" : "value",
          );
          continue;
        }
        if (specifier === undefined || !specifier.startsWith(".")) {
          throw new Error(
            `${file}: \`export * from "${specifier}"\` cannot be indexed; name the exports`,
          );
        }
        const target = moduleExports(
          resolveRelativeModule(file, specifier),
          cache,
        );
        for (const [name, kind] of target) {
          if (name === "default") continue;
          record(exports, name, statement.isTypeOnly ? "type" : kind);
        }
        continue;
      }
      const target =
        specifier !== undefined && specifier.startsWith(".")
          ? moduleExports(resolveRelativeModule(file, specifier), cache)
          : undefined;
      for (const element of clause.elements) {
        const original = (element.propertyName ?? element.name).text;
        const resolved =
          specifier === undefined
            ? locals.get(original)
            : target === undefined
              ? "value"
              : target.get(original);
        if (resolved === undefined) {
          throw new Error(
            `${file}: cannot find "${original}" exported as "${element.name.text}"`,
          );
        }
        record(
          exports,
          element.name.text,
          statement.isTypeOnly || element.isTypeOnly ? "type" : resolved,
        );
      }
      continue;
    }
    if (ts.isExportAssignment(statement)) {
      record(exports, "default", "value");
      continue;
    }
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    if (isInternal(statement)) continue;
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    for (const [name, kind] of declaredNames(statement)) {
      record(exports, isDefault ? "default" : name, kind);
    }
  }
  return exports;
}

function byName(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function readPublicEntries(sdkRoot) {
  const manifest = JSON.parse(
    readFileSync(path.join(sdkRoot, "package.json"), "utf8"),
  );
  return Object.entries(manifest.exports)
    .filter(([subpath]) => !subpath.startsWith("./internal/"))
    .map(([subpath, conditions]) => ({
      subpath,
      source: path.join(sdkRoot, conditions.source),
      types: path.join(sdkRoot, conditions.types),
    }));
}

export function collectEntryExports(sourceFile) {
  const exports = moduleExports(sourceFile, new Map());
  const names = (kind) =>
    [...exports]
      .filter(([name, exportKind]) => name !== "default" && exportKind === kind)
      .map(([name]) => name)
      .sort(byName);
  return { values: names("value"), types: names("type") };
}

function importSpecifier(subpath) {
  return subpath === "." ? PACKAGE_NAME : `${PACKAGE_NAME}/${subpath.slice(2)}`;
}

function wrapNames(names) {
  const lines = [];
  let line = "";
  for (const [index, name] of names.entries()) {
    const item = `\`${name}\`${index === names.length - 1 ? "" : ","}`;
    if (line !== "" && line.length + 1 + item.length > LINE_WIDTH) {
      lines.push(line);
      line = item;
      continue;
    }
    line = line === "" ? item : `${line} ${item}`;
  }
  if (line !== "") lines.push(line);
  return lines;
}

function renderList(heading, names) {
  const visible = names.filter((name) => !HIDDEN_NAME.test(name));
  if (visible.length === 0) return [];
  return [`### ${heading}`, "", ...wrapNames(visible), ""];
}

export function renderApiIndexes(sdkRoot) {
  const entries = new Map(
    readPublicEntries(sdkRoot).map((entry) => [entry.subpath, entry]),
  );
  const indexed = new Set(
    API_INDEX_FILES.flatMap((file) =>
      file.entries.map((entry) => entry.subpath),
    ),
  );
  const unassigned = [...entries.keys()].filter(
    (subpath) => !indexed.has(subpath),
  );
  if (unassigned.length > 0) {
    throw new Error(
      `Assign these ${PACKAGE_NAME} entry points to an index in API_INDEX_FILES: ${unassigned.join(", ")}`,
    );
  }
  return API_INDEX_FILES.map((file) => {
    const lines = [`# ${file.title}`, "", ...file.intro, ""];
    for (const { subpath, note } of file.entries) {
      const entry = entries.get(subpath);
      if (entry === undefined) {
        throw new Error(
          `${file.filename}: ${PACKAGE_NAME} has no "${subpath}" entry point`,
        );
      }
      const { values, types } = collectEntryExports(entry.source);
      lines.push(`## \`${importSpecifier(subpath)}\``, "");
      if (note !== undefined) lines.push(...note, "");
      lines.push(
        ...renderList("Runtime values", values),
        ...renderList("Type exports", types),
      );
    }
    return {
      filename: file.filename,
      content: `${lines.join("\n").trimEnd()}\n`,
    };
  });
}
