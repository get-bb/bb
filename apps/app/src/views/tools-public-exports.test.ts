import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const RESOURCE_LIST_EXPORTS = [
  "RESOURCE_ROUTE_LABEL_EVENT",
  "ResourceActionButton",
  "ResourceActivitySection",
  "ResourceBrowseCard",
  "ResourceBrowseGrid",
  "ResourceBrowseSection",
  "ResourceBrowseSectionItem",
  "ResourceCardStat",
  "ResourceCollectionMode",
  "ResourceCollectionPage",
  "ResourceCollectionViewport",
  "ResourceCreateButton",
  "ResourceCreateMenuAction",
  "ResourceCreateTemplate",
  "ResourceDefinitionSection",
  "ResourceDetailActionRow",
  "ResourceDetailCollection",
  "ResourceDetailConfigurationSection",
  "ResourceDetailFact",
  "ResourceDetailFacts",
  "ResourceDetailIncludesSection",
  "ResourceDetailList",
  "ResourceDetailListItem",
  "ResourceDetailOverviewSection",
  "ResourceDetailPage",
  "ResourceDetailPanel",
  "ResourceDetailReleaseSection",
  "ResourceDetailSection",
  "ResourceDetailSectionKind",
  "ResourceDetailSectionProps",
  "ResourceDetailStack",
  "ResourceDetailSurface",
  "ResourceInstallControl",
  "ResourceInstalledControl",
  "ResourceLifecycleStatus",
  "ResourceListPanel",
  "ResourceListState",
  "ResourceLocationMeta",
  "ResourceMeta",
  "ResourceMultiSelectMenu",
  "ResourceOption",
  "ResourceOptionMenu",
  "ResourceOverflowMenu",
  "ResourceOverflowMenuItem",
  "ResourceOverview",
  "ResourceOverviewPage",
  "ResourceOverviewSection",
  "ResourcePromptContextItem",
  "ResourcePromptEditor",
  "ResourcePromptPreview",
  "ResourceProperty",
  "ResourcePropertyList",
  "ResourceRow",
  "ResourceRowDetailChevron",
  "ResourceSection",
  "ResourceSectionTitle",
  "ResourceShelfAction",
  "ResourceShelfSeeAllAction",
  "ResourceSortMenu",
  "ResourceSourceItem",
  "ResourceSourceShelf",
  "ResourceState",
  "ResourceStatus",
  "ResourceStatusTone",
  "ResourceTabDescription",
  "ResourceTemplateBrowseCard",
  "ResourceToolbar",
  "ResourceToolbarAction",
  "useResourceRouteLabel",
] as const;

const SKILLS_VIEW_EXPORTS = [
  "ProviderLogo",
  "RegistryPagination",
  "RegistrySkill",
  "RegistrySkillDetail",
  "RegistrySkillFile",
  "RegistrySkillsBrowsePage",
  "RegistrySkillsPage",
  "SkillDetailDialogView",
  "SkillDetailDialogViewProps",
  "SkillsLibrary",
  "SkillsOverview",
  "SkillsOverviewProps",
  "SkillsView",
  "fetchRegistrySkillDetail",
  "fetchRegistrySkillEntry",
  "fetchRegistrySkills",
  "formatInstallCount",
  "formatRegistrySource",
  "installRegistrySkill",
  "normalizeSkillName",
  "resolveInstalledRegistrySkill",
] as const;

const TOOLS_VIEW_EXPORTS = [
  "PluginDetail",
  "ToolsScrollPage",
  "ToolsView",
] as const;

function exportedNames(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const names: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (
        statement.exportClause === undefined ||
        !ts.isNamedExports(statement.exportClause)
      ) {
        throw new Error(`${filePath} must use explicit named exports`);
      }
      names.push(
        ...statement.exportClause.elements.map((element) => element.name.text),
      );
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (
      modifiers?.some(
        (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
      ) !== true
    ) {
      continue;
    }
    if (
      modifiers.some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
    ) {
      throw new Error(`${filePath} must not add a default export`);
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) {
          throw new Error(`${filePath} must use named exported declarations`);
        }
        names.push(declaration.name.text);
      }
    } else if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name !== undefined &&
      ts.isIdentifier(statement.name)
    ) {
      names.push(statement.name.text);
    } else {
      throw new Error(`${filePath} has an unsupported exported declaration`);
    }
  }

  return names.sort();
}

describe("Tools Hub public export contracts", () => {
  const surfaces = [
    {
      name: "shared resource list",
      filePath: fileURLToPath(
        new URL(
          "../../../../packages/shared-ui/src/components/ui/resource-list.tsx",
          import.meta.url,
        ),
      ),
      expected: RESOURCE_LIST_EXPORTS,
    },
    {
      name: "SkillsView",
      filePath: fileURLToPath(new URL("./SkillsView.tsx", import.meta.url)),
      expected: SKILLS_VIEW_EXPORTS,
    },
    {
      name: "ToolsView",
      filePath: fileURLToPath(new URL("./ToolsView.tsx", import.meta.url)),
      expected: TOOLS_VIEW_EXPORTS,
    },
  ] as const;

  for (const surface of surfaces) {
    it(`keeps the exact ${surface.name} surface`, () => {
      expect(exportedNames(surface.filePath)).toEqual(
        [...surface.expected].sort(),
      );
    });
  }
});
