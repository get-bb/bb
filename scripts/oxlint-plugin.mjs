const blockingChildProcessCalls = new Set([
  "execFileSync",
  "execSync",
  "spawnSync",
]);

function isSemanticComment(commentText) {
  const directive = commentText
    .replace(/^\/\/\/?/, "")
    .replace(/^\/\*+/, "")
    .trimStart();

  return (
    /^#!/.test(commentText) ||
    /^\/\/\/\s*<(?:reference|amd-module|amd-dependency)\b/.test(commentText) ||
    /^@ts-(?:check|expect-error|ignore|nocheck)\b/.test(directive) ||
    /^@jsx(?:Frag|ImportSource|Runtime)?\b/.test(directive) ||
    /^@(?:vitest|jest)-environment\b/.test(directive) ||
    /^(?:eslint|oxlint)-(?:disable|enable)(?:-next-line|-line)?\b/.test(
      directive,
    ) ||
    /^(?:prettier|oxfmt)-ignore\b/.test(directive) ||
    /^@vite-ignore\b/.test(directive) ||
    /^webpack(?:ChunkName|Mode|Prefetch|Preload|Exports|FetchPriority)\b/.test(
      directive,
    ) ||
    /^(?:v8|c8|istanbul)\s+ignore\b/i.test(directive) ||
    /^[@#]__PURE__\b/.test(directive) ||
    /^(?:#|@)?\s*sourceMappingURL=|^(?:#|@)?\s*sourceURL=/.test(directive) ||
    /^@(?:license|preserve)\b/i.test(directive) ||
    /@(?:deprecated|experimental|internal)\b/.test(commentText)
  );
}

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
