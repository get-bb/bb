import { PageShell } from "@/components/ui/page-shell.js";
import { SkillsLibrary } from "@/components/tools/SkillsLibrary";

export type {
  RegistryPagination,
  RegistrySkill,
  RegistrySkillDetail,
  RegistrySkillFile,
  RegistrySkillsPage,
} from "@/lib/skills-registry";
export {
  fetchRegistrySkillDetail,
  fetchRegistrySkillEntry,
  fetchRegistrySkills,
  formatInstallCount,
  formatRegistrySource,
  installRegistrySkill,
  normalizeSkillName,
  resolveInstalledRegistrySkill,
} from "@/lib/skills-registry";
export { RegistrySkillsBrowsePage } from "@/components/tools/SkillsBrowse";
export type {
  SkillDetailDialogViewProps,
  SkillsOverviewProps,
} from "@/components/tools/SkillsCollection";
export {
  ProviderLogo,
  SkillDetailDialogView,
  SkillsOverview,
} from "@/components/tools/SkillsCollection";
export { SkillsLibrary } from "@/components/tools/SkillsLibrary";

export function SkillsView() {
  return (
    <PageShell contentClassName="pt-4 md:pt-5" maxWidthClassName="max-w-5xl">
      <SkillsLibrary />
    </PageShell>
  );
}
