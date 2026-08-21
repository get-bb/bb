// Skills: the user's library (project skills of the personal project) and
// the skills.sh registry browse / install. Mirrors the web's skills-queries +
// lib/skills-registry on the active profile's SDK.
export {
  accumulateRegistryPage,
  describeRegistrySkill,
  filterSkills,
  formatInstallCount,
  formatRegistrySource,
  groupSkillsByScope,
  isSkillDeletable,
  pickRegistrySkillFile,
  resolveInstalledRegistrySkill,
  skillScopeLabel,
  type ProviderDisplayNames,
  type RegistrySkillsAccumulator,
} from "./skill-model";
export {
  useProjectSkill,
  useProjectSkills,
  useRegistrySkillDetail,
  useRegistrySkillEntry,
  useRegistrySkills,
  useSkillContent,
  useSkillFiles,
} from "./skill-queries";
export { useDeleteSkill, useInstallRegistrySkill } from "./skill-mutations";
