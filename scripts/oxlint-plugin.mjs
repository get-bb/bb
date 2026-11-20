import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isSemanticComment } from "./lib/semantic-comment.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const forkablePluginRoots = JSON.parse(
  readFileSync(new URL("./forkable-plugins.json", import.meta.url), "utf8"),
).plugins.map((pluginDir) => `${path.resolve(repoRoot, pluginDir)}${path.sep}`);
const registryDir = path.join(repoRoot, "packages", "plugin-registry", "r");
const registryAliases = new Set(
  readdirSync(registryDir)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .flatMap(
      (name) =>
        JSON.parse(readFileSync(path.join(registryDir, name), "utf8")).files,
    )
    .map((file) => `@/${file.target.replace(/\.(?:tsx?|jsx?)$/u, "")}`),
);
const workspacePackageNames = new Set(
  ["apps", "packages", "plugins", "tests", "examples/plugins"]
    .flatMap((dir) =>
      readdirSync(path.join(repoRoot, dir)).map((name) =>
        path.join(repoRoot, dir, name, "package.json"),
      ),
    )
    .filter((manifestPath) => existsSync(manifestPath))
    .map((manifestPath) => JSON.parse(readFileSync(manifestPath, "utf8")).name)
    .filter((name) => name !== "@get-bb/plugin-sdk"),
);

function isWorkspacePackage(specifier) {
  const segments = specifier.split("/");
  return (
    specifier.startsWith("@bb/") ||
    workspacePackageNames.has(
      specifier.startsWith("@") ? segments.slice(0, 2).join("/") : segments[0],
    )
  );
}

const moduleLoaderCalls = new Set([
  "require",
  "vi.mock",
  "vi.doMock",
  "vi.unmock",
  "vi.doUnmock",
  "vi.importActual",
  "vi.importMock",
]);
const blockingChildProcessCalls = new Set([
  "execFileSync",
  "execSync",
  "spawnSync",
]);

const noBlockingChildProcessCall = {
  create(context) {
    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          blockingChildProcessCalls.has(node.callee.name)
        ) {
          context.report({
            node: node.callee,
            message:
              "Use async child_process APIs instead of blocking sync variants.",
          });
        }
      },
    };
  },
};

const rawChildProcessModules = new Set([
  "node:child_process",
  "child_process",
  "cross-spawn",
  "execa",
]);

const noRawChildProcess = {
  create(context) {
    function check(node, typeOnly) {
      if (typeOnly) return;
      if (node?.type !== "Literal" || typeof node.value !== "string") return;
      if (!rawChildProcessModules.has(node.value)) return;
      context.report({
        node,
        message: `${node.value} spawns outside the host spawn policy. Use the @bb/process-utils helpers (spawnHostProcess, execHostFile, forkHostProcess, spawnManagedProcess, execPortableFile), or @get-bb/plugin-sdk/process in a plugin, so PATH, proxy, and windowsHide come from one owner.`,
      });
    }
    return {
      ImportDeclaration(node) {
        check(
          node.source,
          node.importKind === "type" ||
            (node.specifiers.length > 0 &&
              node.specifiers.every(
                (specifier) => specifier.importKind === "type",
              )),
        );
      },
      ExportNamedDeclaration(node) {
        check(node.source, node.exportKind === "type");
      },
      ExportAllDeclaration(node) {
        check(node.source, node.exportKind === "type");
      },
      ImportExpression(node) {
        check(node.source, false);
      },
      TSImportEqualsDeclaration(node) {
        if (node.moduleReference.type !== "TSExternalModuleReference") return;
        check(node.moduleReference.expression, node.importKind === "type");
      },
      CallExpression(node) {
        const callee = calleeName(node.callee);
        if (callee === "require" || callee === "process.getBuiltinModule") {
          check(node.arguments[0], false);
        }
      },
    };
  },
};

function findJsxAttribute(node, name) {
  return node.attributes.find(
    (attribute) =>
      attribute.type === "JSXAttribute" &&
      attribute.name.type === "JSXIdentifier" &&
      attribute.name.name === name,
  );
}

const noNativeTitleWithAriaLabel = {
  create(context) {
    return {
      JSXOpeningElement(node) {
        const titleAttribute = findJsxAttribute(node, "title");
        if (titleAttribute && findJsxAttribute(node, "aria-label")) {
          context.report({
            node: titleAttribute,
            message:
              "Do not pair aria-label with a native title tooltip. Use aria-label for the accessible name and a design-system Tooltip, or put title on the truncated text only.",
          });
        }
      },
    };
  },
};

const noNativeTitleOnButton = {
  create(context) {
    return {
      JSXOpeningElement(node) {
        if (node.name.type === "JSXIdentifier" && node.name.name === "Button") {
          const titleAttribute = findJsxAttribute(node, "title");
          if (titleAttribute) {
            context.report({
              node: titleAttribute,
              message:
                "Do not put native title tooltips on the shared Button primitive. Use aria-label for icon-only buttons and a design-system Tooltip when visible hover help is intentional.",
            });
          }
        }
      },
    };
  },
};

function calleeName(callee) {
  if (callee.type === "Identifier") return callee.name;
  if (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.property.type === "Identifier"
  ) {
    return `${callee.object.name}.${callee.property.name}`;
  }
  return null;
}

const forkablePluginImports = {
  create(context) {
    const filename = path.resolve(context.filename);
    const pluginRoot = forkablePluginRoots.find((root) =>
      filename.startsWith(root),
    );
    if (pluginRoot === undefined) return {};

    function check(node) {
      if (node?.type !== "Literal" || typeof node.value !== "string") return;
      const specifier = node.value;
      if (isWorkspacePackage(specifier)) {
        context.report({
          node,
          message: `${specifier} is a bb workspace package, which a copy of this plugin cannot install. Forkable plugins import only @get-bb/plugin-sdk, npm packages, their own files, and registry components through @/ (for example @/components/ui/button) (scripts/forkable-plugins.json).`,
        });
        return;
      }
      if (specifier.startsWith("@get-bb/plugin-sdk/internal/")) {
        context.report({
          node,
          message: `${specifier} is an internal SDK module that bb can change in any release. Forkable plugins import only the SDK's public entry points (scripts/forkable-plugins.json).`,
        });
        return;
      }
      if (specifier.startsWith("@/") && !registryAliases.has(specifier)) {
        context.report({
          node,
          message: `${specifier} is not a component registry file, so a fork cannot write it into its copy. @/ imports name registry targets such as @/components/ui/button or @/lib/utils (scripts/forkable-plugins.json).`,
        });
        return;
      }
      if (
        specifier.startsWith(".") &&
        !`${path.resolve(path.dirname(filename), specifier)}${path.sep}`.startsWith(
          pluginRoot,
        )
      ) {
        context.report({
          node,
          message: `${specifier} reaches outside the plugin directory, which a copy of this plugin does not have (scripts/forkable-plugins.json).`,
        });
      }
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        check(node.source);
      },
      ExportAllDeclaration(node) {
        check(node.source);
      },
      ImportExpression(node) {
        check(node.source);
      },
      TSImportType(node) {
        check(node.source);
      },
      CallExpression(node) {
        if (moduleLoaderCalls.has(calleeName(node.callee))) {
          check(node.arguments[0]);
        }
      },
    };
  },
};

const coreContributionRoot = `${path.join(repoRoot, "apps", "app", "src", "core-contributions")}${path.sep}`;
const sharedUiDir = path.join(repoRoot, "packages", "shared-ui");
const registrySourceFiles = new Set(
  readdirSync(registryDir)
    .filter((name) => name.endsWith(".json") && name !== "index.json")
    .flatMap(
      (name) =>
        JSON.parse(readFileSync(path.join(registryDir, name), "utf8")).files,
    )
    .map((file) => path.join(sharedUiDir, "src", file.target)),
);
const registrySharedUiSpecifiers = new Set(
  Object.entries(
    JSON.parse(readFileSync(path.join(sharedUiDir, "package.json"), "utf8"))
      .exports,
  )
    .filter(([, target]) =>
      registrySourceFiles.has(
        path.join(
          sharedUiDir,
          typeof target === "string" ? target : target.source,
        ),
      ),
    )
    .map(([subpath]) => `@bb/shared-ui/${subpath.slice(2)}`),
);
const hostContextPackages = new Set([
  "jotai",
  "@tanstack/react-query",
  "react-router",
  "react-router-dom",
]);

function packageName(specifier) {
  const segments = specifier.split("/");
  return specifier.startsWith("@")
    ? segments.slice(0, 2).join("/")
    : segments[0];
}

const coreContributionImports = {
  create(context) {
    const filename = path.resolve(context.filename);
    if (!filename.startsWith(coreContributionRoot)) return {};
    const boundary =
      "Core contributions use only what a plugin gets: @get-bb/plugin-sdk public entry points, registry components (@bb/shared-ui subpaths that packages/plugin-registry publishes), React, npm packages, and other files in apps/app/src/core-contributions.";

    function check(node) {
      if (node?.type !== "Literal" || typeof node.value !== "string") return;
      const specifier = node.value;
      if (specifier.startsWith("@get-bb/plugin-sdk/internal/")) {
        context.report({
          node,
          message: `${specifier} is an internal SDK module. ${boundary}`,
        });
        return;
      }
      if (packageName(specifier) === "@get-bb/plugin-sdk") return;
      if (registrySharedUiSpecifiers.has(specifier)) return;
      if (specifier.startsWith("@/")) {
        context.report({
          node,
          message: `${specifier} is a private app module. ${boundary}`,
        });
        return;
      }
      if (isWorkspacePackage(specifier)) {
        context.report({
          node,
          message: `${specifier} is a bb workspace module that plugins cannot import. ${boundary}`,
        });
        return;
      }
      if (hostContextPackages.has(packageName(specifier))) {
        context.report({
          node,
          message: `${specifier} reads bb's own provider state (store, query cache, router), which a plugin's copy of the library cannot see. ${boundary}`,
        });
        return;
      }
      if (
        specifier.startsWith(".") &&
        !path
          .resolve(path.dirname(filename), specifier)
          .startsWith(coreContributionRoot)
      ) {
        context.report({
          node,
          message: `${specifier} reaches outside apps/app/src/core-contributions. ${boundary}`,
        });
      }
    }

    function checkExport(node) {
      context.report({
        node,
        message:
          "A core contribution exports only its default definePluginApp definition, so core cannot pass private state into it or reuse its internals.",
      });
    }

    return {
      ImportDeclaration(node) {
        check(node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) check(node.source);
        checkExport(node);
      },
      ExportAllDeclaration(node) {
        check(node.source);
        checkExport(node);
      },
      ImportExpression(node) {
        check(node.source);
      },
      TSImportType(node) {
        check(node.source);
      },
      CallExpression(node) {
        if (moduleLoaderCalls.has(calleeName(node.callee))) {
          check(node.arguments[0]);
        }
      },
    };
  },
};

const noComments = {
  meta: {
    fixable: "whitespace",
  },
  create(context) {
    const sourceCode = context.sourceCode;

    return {
      Program() {
        const fileText = sourceCode.getText();

        for (const comment of sourceCode.getAllComments()) {
          const commentText = sourceCode.getText(comment);

          if (isSemanticComment(commentText)) {
            continue;
          }

          context.report({
            node: comment,
            message: "Code comments are forbidden.",
            fix(fixer) {
              if (/\r|\n/.test(commentText)) {
                return fixer.replaceText(
                  comment,
                  commentText.replace(/[^\r\n]/g, ""),
                );
              }

              const [start, end] = comment.range;
              const before = fileText[start - 1];
              const after = fileText[end];
              const needsSeparator =
                commentText.startsWith("/*") &&
                before !== undefined &&
                after !== undefined &&
                !/\s/.test(before) &&
                !/\s/.test(after);

              return fixer.replaceText(comment, needsSeparator ? " " : "");
            },
          });
        }
      },
    };
  },
};

const resizeObserverMessage =
  "Observe element sizes with observeSharedResize or useMeasuredValue from @bb/shared-ui. They apply React state in the same frame as the resize; a raw ResizeObserver callback's setState paints one frame late.";

function isResizeObserverConstructor(callee) {
  if (callee.type === "Identifier") return callee.name === "ResizeObserver";
  return (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.type === "Identifier" &&
    callee.property.name === "ResizeObserver"
  );
}

const noRawResizeObserver = {
  create(context) {
    return {
      NewExpression(node) {
        if (isResizeObserverConstructor(node.callee)) {
          context.report({ node: node.callee, message: resizeObserverMessage });
        }
      },
      ImportDeclaration(node) {
        if (node.source.value !== "usehooks-ts") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "useResizeObserver"
          ) {
            context.report({ node: specifier, message: resizeObserverMessage });
          }
        }
      },
    };
  },
};

const imeSensitiveKeys = new Set(["Enter", "Escape"]);
const imeSafeKeyMessage = (key) =>
  `Match ${key} with isNonImeKey(event, "${key}") from @bb/shared-ui/lib/ime-keyboard (@/lib/ime-keyboard in plugins). A raw key check fires on the keystroke that confirms or cancels Chinese, Japanese, or Korean input-method composition; Safari reports that keystroke with isComposing false and keyCode 229.`;

function isKeyMember(node) {
  return (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier" &&
    node.property.name === "key"
  );
}

function imeSensitiveKeyLiteral(node) {
  return node.type === "Literal" && imeSensitiveKeys.has(node.value)
    ? node.value
    : null;
}

const imeSafeKeyHandlers = {
  create(context) {
    return {
      BinaryExpression(node) {
        if (!["===", "!==", "==", "!="].includes(node.operator)) return;
        const key = isKeyMember(node.left)
          ? imeSensitiveKeyLiteral(node.right)
          : isKeyMember(node.right)
            ? imeSensitiveKeyLiteral(node.left)
            : null;
        if (key !== null) {
          context.report({ node, message: imeSafeKeyMessage(key) });
        }
      },
      SwitchCase(node) {
        const key =
          node.test === null ? null : imeSensitiveKeyLiteral(node.test);
        const switchStatement = node.parent;
        if (key !== null && isKeyMember(switchStatement.discriminant)) {
          context.report({ node, message: imeSafeKeyMessage(key) });
        }
      },
    };
  },
};

export const rules = {
  "core-contribution-imports": coreContributionImports,
  "forkable-plugin-imports": forkablePluginImports,
  "ime-safe-key-handlers": imeSafeKeyHandlers,
  "no-blocking-child-process-call": noBlockingChildProcessCall,
  "no-comments": noComments,
  "no-native-title-on-button": noNativeTitleOnButton,
  "no-native-title-with-aria-label": noNativeTitleWithAriaLabel,
  "no-raw-child-process": noRawChildProcess,
  "no-raw-resize-observer": noRawResizeObserver,
};

export default {
  meta: {
    name: "bb",
  },
  rules,
};
