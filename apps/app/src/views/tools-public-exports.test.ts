import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

function names(value: string): string[] {
  return value.trim().split(/\s+/u);
}

const RESOURCE_LIST_EXPORTS = names(`
  RESOURCE_ROUTE_LABEL_EVENT ResourceActionButton ResourceActivitySection ResourceBrowseCard ResourceBrowseGrid ResourceBrowseSection ResourceBrowseSectionItem
  ResourceCardStat ResourceCollectionMode ResourceCollectionPage ResourceCollectionViewport ResourceCreateButton ResourceCreateMenuAction ResourceCreateTemplate
  ResourceDefinitionSection ResourceDetailActionRow ResourceDetailCollection ResourceDetailConfigurationSection ResourceDetailFact ResourceDetailFacts
  ResourceDetailIncludesSection ResourceDetailList ResourceDetailListItem ResourceDetailOverviewSection ResourceDetailPage ResourceDetailPanel ResourceDetailReleaseSection
  ResourceDetailSection ResourceDetailSectionKind ResourceDetailSectionProps ResourceDetailStack ResourceDetailSurface ResourceInstallControl ResourceInstalledControl
  ResourceLifecycleStatus ResourceListPanel ResourceListState ResourceLocationMeta ResourceMeta ResourceMultiSelectMenu ResourceOption ResourceOptionMenu
  ResourceOverflowMenu ResourceOverflowMenuItem ResourceOverview ResourceOverviewPage ResourceOverviewSection ResourcePromptContextItem ResourcePromptEditor
  ResourcePromptPreview ResourceProperty ResourcePropertyList ResourceRow ResourceRowDetailChevron ResourceSection ResourceSectionTitle ResourceShelfAction
  ResourceShelfSeeAllAction ResourceSortMenu ResourceSourceItem ResourceSourceShelf ResourceState ResourceStatus ResourceStatusTone ResourceTabDescription
  ResourceTemplateBrowseCard ResourceToolbar ResourceToolbarAction useResourceRouteLabel
`);

const SKILLS_VIEW_EXPORTS = names(`
  ProviderLogo RegistryPagination RegistrySkill RegistrySkillDetail RegistrySkillFile RegistrySkillsBrowsePage RegistrySkillsPage SkillDetailDialogView
  SkillDetailDialogViewProps SkillsLibrary SkillsOverview SkillsOverviewProps SkillsView fetchRegistrySkillDetail fetchRegistrySkillEntry fetchRegistrySkills
  formatInstallCount formatRegistrySource installRegistrySkill normalizeSkillName resolveInstalledRegistrySkill
`);

const TOOLS_VIEW_EXPORTS = names(`PluginDetail ToolsScrollPage ToolsView`);

function exportedNames(filePath: string): string[] {
  const sourceFile = ts.createSourceFile(
    filePath,
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const exported: string[] = [];

  for (const statement of sourceFile.statements) {
    if (ts.isExportDeclaration(statement)) {
      if (!statement.exportClause || !ts.isNamedExports(statement.exportClause))
        throw new Error(`${filePath} must use explicit named exports`);
      exported.push(
        ...statement.exportClause.elements.map(({ name }) => name.text),
      );
      continue;
    }

    const modifiers = ts.canHaveModifiers(statement)
      ? ts.getModifiers(statement)
      : undefined;
    if (!modifiers?.some(({ kind }) => kind === ts.SyntaxKind.ExportKeyword))
      continue;
    if (
      modifiers.some(({ kind }) => kind === ts.SyntaxKind.DefaultKeyword) ||
      !ts.isFunctionDeclaration(statement) ||
      !statement.name
    ) {
      throw new Error(`${filePath} must use explicit named exports`);
    }
    exported.push(statement.name.text);
  }

  return exported.sort();
}

describe("Tools Hub public export contracts", () => {
  const here = (path: string) => new URL(path, import.meta.url);
  const surfaces = [
    [
      "shared resource list",
      here(
        "../../../../packages/shared-ui/src/components/ui/resource-list.tsx",
      ),
      RESOURCE_LIST_EXPORTS,
    ],
    ["SkillsView", here("./SkillsView.tsx"), SKILLS_VIEW_EXPORTS],
    ["ToolsView", here("./ToolsView.tsx"), TOOLS_VIEW_EXPORTS],
  ] as const;

  for (const [name, url, expected] of surfaces) {
    it(`keeps the exact ${name} surface`, () => {
      expect(exportedNames(fileURLToPath(url))).toEqual([...expected].sort());
    });
  }
});
