import { readdirSync, readFileSync } from "node:fs";
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
      if (specifier.startsWith("@bb/")) {
        context.report({
          node,
          message: `${specifier} is a bb workspace package, which a copy of this plugin cannot install. Forkable plugins import only @get-bb/plugin-sdk, npm packages, their own files, and registry components through @/ (for example @/components/ui/button) (scripts/forkable-plugins.json).`,
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

export const rules = {
  "forkable-plugin-imports": forkablePluginImports,
  "no-blocking-child-process-call": noBlockingChildProcessCall,
  "no-comments": noComments,
  "no-native-title-on-button": noNativeTitleOnButton,
  "no-native-title-with-aria-label": noNativeTitleWithAriaLabel,
};

export default {
  meta: {
    name: "bb",
  },
  rules,
};
