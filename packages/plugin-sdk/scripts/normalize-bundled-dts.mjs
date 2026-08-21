import ts from "typescript";

function typeReferenceName(typeName) {
  return ts.isIdentifier(typeName) ? typeName.text : typeName.right.text;
}

function normalizeQuotedLiteralUnions(content) {
  return content.replace(
    /"(?:[^"\\]|\\.)+"(?: \| "(?:[^"\\]|\\.)+")+/gu,
    (union) => union.split(" | ").sort().join(" | "),
  );
}

const UNORDERED_ZOD_TYPE_LITERALS = new Set(["ZodEnum", "ZodObject"]);

function applyReplacements(content, rangeStart, rangeEnd, replacements) {
  if (replacements.length === 0) return content.slice(rangeStart, rangeEnd);

  const chunks = [];
  let cursor = rangeStart;
  for (const replacement of [...replacements].sort(
    (a, b) => a.start - b.start,
  )) {
    chunks.push(content.slice(cursor, replacement.start), replacement.text);
    cursor = replacement.end;
  }
  chunks.push(content.slice(cursor, rangeEnd));
  return chunks.join("");
}

function normalizeZodTypeLiterals(content) {
  const sourceFile = ts.createSourceFile(
    "bundled.d.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const roots = [];

  function visit(node, parentTarget) {
    let target = parentTarget;
    if (
      ts.isTypeLiteralNode(node) &&
      ts.isTypeReferenceNode(node.parent) &&
      node.parent.typeArguments?.[0] === node &&
      UNORDERED_ZOD_TYPE_LITERALS.has(
        typeReferenceName(node.parent.typeName),
      ) &&
      node.members.length > 1 &&
      node.members.every(ts.isPropertySignature)
    ) {
      target = { node, children: [] };
      if (parentTarget) parentTarget.children.push(target);
      else roots.push(target);
    }
    ts.forEachChild(node, (child) => visit(child, target));
  }

  visit(sourceFile, null);

  function renderTarget(target) {
    const members = target.node.members.map((member) => {
      const start = member.getStart(sourceFile);
      const end = member.getEnd();
      const nestedReplacements = target.children
        .filter(
          (child) =>
            child.node.getStart(sourceFile) >= start &&
            child.node.getEnd() <= end,
        )
        .map((child) => ({
          start: child.node.getStart(sourceFile),
          end: child.node.getEnd(),
          text: renderTarget(child),
        }));
      return {
        start,
        end,
        sortKey: member.name.getText(sourceFile),
        text: applyReplacements(content, start, end, nestedReplacements),
      };
    });
    const sorted = [...members].sort((a, b) => {
      if (a.sortKey < b.sortKey) return -1;
      if (a.sortKey > b.sortKey) return 1;
      if (a.text < b.text) return -1;
      if (a.text > b.text) return 1;
      return 0;
    });
    const replacements = members.map((member, index) => ({
      start: member.start,
      end: member.end,
      text: sorted[index].text,
    }));
    return applyReplacements(
      content,
      target.node.getStart(sourceFile),
      target.node.getEnd(),
      replacements,
    );
  }

  return applyReplacements(
    content,
    0,
    content.length,
    roots.map((root) => ({
      start: root.node.getStart(sourceFile),
      end: root.node.getEnd(),
      text: renderTarget(root),
    })),
  );
}

/**
 * Normalize declaration syntax whose order is semantically irrelevant but is
 * emitted inconsistently by TypeScript/rollup-plugin-dts.
 */
export function normalizeBundledDts(content) {
  return normalizeZodTypeLiterals(normalizeQuotedLiteralUnions(content));
}
