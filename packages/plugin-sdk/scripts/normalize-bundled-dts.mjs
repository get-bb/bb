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

function normalizeZodEnumMaps(content) {
  const sourceFile = ts.createSourceFile(
    "bundled.d.ts",
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const replacements = [];

  function visit(node) {
    if (
      ts.isTypeReferenceNode(node) &&
      typeReferenceName(node.typeName) === "ZodEnum"
    ) {
      const enumMap = node.typeArguments?.[0];
      if (
        enumMap &&
        ts.isTypeLiteralNode(enumMap) &&
        enumMap.members.length > 1 &&
        enumMap.members.every(ts.isPropertySignature)
      ) {
        const members = enumMap.members.map((member) => ({
          start: member.getStart(sourceFile),
          end: member.getEnd(),
          sortKey: member.name.getText(sourceFile),
          text: content.slice(member.getStart(sourceFile), member.getEnd()),
        }));
        const sorted = [...members].sort((a, b) => {
          if (a.sortKey < b.sortKey) return -1;
          if (a.sortKey > b.sortKey) return 1;
          if (a.text < b.text) return -1;
          if (a.text > b.text) return 1;
          return 0;
        });

        for (let index = 0; index < members.length; index += 1) {
          if (members[index].text === sorted[index].text) continue;
          replacements.push({
            start: members[index].start,
            end: members[index].end,
            text: sorted[index].text,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return replacements
    .sort((a, b) => b.start - a.start)
    .reduce(
      (normalized, replacement) =>
        normalized.slice(0, replacement.start) +
        replacement.text +
        normalized.slice(replacement.end),
      content,
    );
}

/**
 * Normalize declaration syntax whose order is semantically irrelevant but is
 * emitted inconsistently by TypeScript/rollup-plugin-dts.
 */
export function normalizeBundledDts(content) {
  return normalizeZodEnumMaps(normalizeQuotedLiteralUnions(content));
}
