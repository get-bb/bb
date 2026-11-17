import { describe, expect, it } from "vitest";
import { rules } from "../../../scripts/oxlint-plugin.mjs";

function literal(value) {
  return { type: "Literal", value };
}

function lint(visit) {
  const reports = [];
  const visitors = rules["no-raw-child-process"].create({
    filename: "/repo/apps/host-daemon/src/example.ts",
    report: (report) => reports.push(report.node.value),
  });
  visit(visitors);
  return reports;
}

describe("no-raw-child-process", () => {
  it.each(["node:child_process", "child_process", "cross-spawn", "execa"])(
    "reports value imports, requires, dynamic imports and re-exports of %s",
    (specifier) => {
      expect(
        lint((visitors) => {
          visitors.ImportDeclaration({
            importKind: "value",
            source: literal(specifier),
            specifiers: [{ importKind: "value" }],
          });
          visitors.ImportDeclaration({
            importKind: "value",
            source: literal(specifier),
            specifiers: [],
          });
          visitors.CallExpression({
            callee: { type: "Identifier", name: "require" },
            arguments: [literal(specifier)],
          });
          visitors.ImportExpression({ source: literal(specifier) });
          visitors.ExportNamedDeclaration({
            exportKind: "value",
            source: literal(specifier),
          });
          visitors.ExportAllDeclaration({
            exportKind: "value",
            source: literal(specifier),
          });
        }),
      ).toEqual(Array(6).fill(specifier));
    },
  );

  it("allows type-only imports and every other module", () => {
    expect(
      lint((visitors) => {
        visitors.ImportDeclaration({
          importKind: "type",
          source: literal("node:child_process"),
          specifiers: [{ importKind: "value" }],
        });
        visitors.ImportDeclaration({
          importKind: "value",
          source: literal("node:child_process"),
          specifiers: [{ importKind: "type" }, { importKind: "type" }],
        });
        visitors.ImportDeclaration({
          importKind: "value",
          source: literal("@bb/process-utils"),
          specifiers: [{ importKind: "value" }],
        });
        visitors.ExportNamedDeclaration({ exportKind: "value", source: null });
      }),
    ).toEqual([]);
  });
});
