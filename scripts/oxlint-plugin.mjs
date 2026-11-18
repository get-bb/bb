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

const rawTextTruncationMessage =
  "Cutting text at a length cap can split a surrogate pair (an emoji) and leave a lone surrogate, which Codex and the Claude API reject. Use sliceUtf16Head or sliceUtf16Tail from @bb/text-utils (or the plugin's own copy in a forkable plugin).";
const stringOnlyCutMethods = new Set(["substring", "substr"]);
const stringProducingMethods = new Set([
  "join",
  "normalize",
  "padEnd",
  "padStart",
  "replace",
  "replaceAll",
  "stringify",
  "text",
  "toLocaleLowerCase",
  "toLocaleUpperCase",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);
const stringConsumingMethods = new Set([
  "charAt",
  "charCodeAt",
  "codePointAt",
  "endsWith",
  "localeCompare",
  "normalize",
  "padEnd",
  "padStart",
  "replace",
  "replaceAll",
  "split",
  "startsWith",
  "toLowerCase",
  "toUpperCase",
  "trim",
  "trimEnd",
  "trimStart",
]);
const asciiOnlyReceiverName =
  /(?:sha|hash|commit|digest|hex|uuid|iso|date|Id|ID|^id)$/u;
const textReceiverName =
  /(?:text|title|message|prompt|output|summary|content|body|label|description|command|instructions?|reason|detail|comment|query|preview|stderr|stdout|snippet|excerpt|markdown|subject|heading|name)$/iu;
const looseTextReceiverName =
  /(?:value|trimmed|normalized|collapsed|sanitized|cleaned|str|string|href|url)$/iu;
const constantName = /^[A-Z][A-Z0-9_]*$/u;
const capName = /(?:max|limit|budget|cap|chars|width|retained|keep)/iu;
const SHORT_ID_PREFIX_MAX = 16;

function unwrapExpression(node) {
  let current = node;
  while (
    current.type === "ParenthesizedExpression" ||
    current.type === "TSAsExpression" ||
    current.type === "TSNonNullExpression" ||
    current.type === "ChainExpression"
  ) {
    current = current.expression;
  }
  return current;
}

function finalName(node) {
  const expression = unwrapExpression(node);
  if (expression.type === "Identifier") return expression.name;
  if (
    expression.type === "MemberExpression" &&
    !expression.computed &&
    expression.property.type === "Identifier"
  ) {
    return expression.property.name;
  }
  return null;
}

function calledMethodName(node) {
  const expression = unwrapExpression(node);
  if (expression.type === "AwaitExpression") {
    return calledMethodName(expression.argument);
  }
  if (expression.type !== "CallExpression") return null;
  if (expression.callee.type === "Identifier") return expression.callee.name;
  return finalName(expression.callee);
}

function isNumericLiteral(node) {
  const expression = unwrapExpression(node);
  return expression.type === "Literal" && typeof expression.value === "number";
}

function isNamedCap(node) {
  const expression = unwrapExpression(node);
  if (
    expression.type !== "Identifier" &&
    expression.type !== "MemberExpression"
  ) {
    return false;
  }
  if (expression.type === "Identifier" && expression.name === "length") {
    return true;
  }
  const name = finalName(expression);
  return name !== null && (constantName.test(name) || capName.test(name));
}

function isLengthCap(node) {
  const expression = unwrapExpression(node);
  if (isNumericLiteral(expression)) return expression.value >= 1;
  if (isNamedCap(expression)) return true;
  if (
    expression.type === "BinaryExpression" &&
    (expression.operator === "-" || expression.operator === "+")
  ) {
    return isLengthCap(expression.left) && !isNumericLiteral(expression.left)
      ? true
      : isNamedCap(expression.right) ||
          (expression.operator === "-" && isNumericLiteral(expression.left));
  }
  if (expression.type === "CallExpression") {
    const name = calleeName(expression.callee);
    return (
      (name === "Math.max" || name === "Math.min") &&
      expression.arguments.some(isLengthCap)
    );
  }
  return false;
}

function cutLength(node) {
  const [first, second] = node.arguments;
  if (first === undefined) return null;
  const start = unwrapExpression(first);
  if (start.type === "Literal" && start.value === 0) {
    return second !== undefined && isLengthCap(second) ? second : null;
  }
  if (
    second === undefined &&
    start.type === "UnaryExpression" &&
    start.operator === "-" &&
    isLengthCap(start.argument)
  ) {
    return start.argument;
  }
  return null;
}

function receiverTextConfidence(receiver) {
  const expression = unwrapExpression(receiver);
  if (expression.type === "TemplateLiteral") return "likely";
  if (expression.type === "Literal") {
    return typeof expression.value === "string" ? "likely" : null;
  }
  if (
    expression.type === "CallExpression" &&
    expression.callee.type === "Identifier" &&
    expression.callee.name === "String"
  ) {
    return "likely";
  }
  const method = calledMethodName(expression);
  if (method !== null)
    return stringProducingMethods.has(method) ? "likely" : null;
  const name = finalName(expression);
  if (name === null) return null;
  if (textReceiverName.test(name)) return "certain";
  return looseTextReceiverName.test(name) ? "likely" : null;
}

function isUsedAsString(node) {
  const parent = node.parent;
  if (parent === undefined || parent === null) return false;
  if (parent.type === "TemplateLiteral") return true;
  if (parent.type === "BinaryExpression" && parent.operator === "+") {
    const other = parent.left === node ? parent.right : parent.left;
    const sibling = unwrapExpression(other);
    return (
      sibling.type === "TemplateLiteral" ||
      (sibling.type === "Literal" && typeof sibling.value === "string")
    );
  }
  if (
    parent.type === "MemberExpression" &&
    parent.object === node &&
    !parent.computed &&
    parent.property.type === "Identifier"
  ) {
    return stringConsumingMethods.has(parent.property.name);
  }
  return false;
}

function isAsciiOnlyReceiver(receiver) {
  const expression = unwrapExpression(receiver);
  const method = calledMethodName(expression);
  if (
    method === "digest" ||
    method === "toISOString" ||
    method === "randomUUID"
  ) {
    return true;
  }
  const name = finalName(expression);
  return name !== null && asciiOnlyReceiverName.test(name);
}

function isShortIdPrefix(length) {
  const expression = unwrapExpression(length);
  if (expression.type === "BinaryExpression") {
    return isShortIdPrefix(expression.left);
  }
  return (
    isNumericLiteral(expression) && expression.value <= SHORT_ID_PREFIX_MAX
  );
}

const noRawTextTruncation = {
  create(context) {
    return {
      CallExpression(node) {
        const callee = unwrapExpression(node.callee);
        if (
          callee.type !== "MemberExpression" ||
          callee.computed ||
          callee.property.type !== "Identifier"
        ) {
          return;
        }
        const method = callee.property.name;
        if (method !== "slice" && !stringOnlyCutMethods.has(method)) return;
        const length = cutLength(node);
        if (length === null || isAsciiOnlyReceiver(callee.object)) return;
        const confidence = stringOnlyCutMethods.has(method)
          ? "certain"
          : receiverTextConfidence(callee.object);
        if (
          confidence === "certain" ||
          ((confidence === "likely" || isUsedAsString(node)) &&
            !isShortIdPrefix(length))
        ) {
          context.report({ node, message: rawTextTruncationMessage });
        }
      },
    };
  },
};

export const rules = {
  "forkable-plugin-imports": forkablePluginImports,
  "ime-safe-key-handlers": imeSafeKeyHandlers,
  "no-blocking-child-process-call": noBlockingChildProcessCall,
  "no-comments": noComments,
  "no-native-title-on-button": noNativeTitleOnButton,
  "no-native-title-with-aria-label": noNativeTitleWithAriaLabel,
  "no-raw-resize-observer": noRawResizeObserver,
  "no-raw-text-truncation": noRawTextTruncation,
};

export default {
  meta: {
    name: "bb",
  },
  rules,
};
