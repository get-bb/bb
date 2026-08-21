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
  type SkillLibraryGroup,
} from "./skill-model";
export {
  useProjectSkill,
  useProjectSkills,
  useRegistrySkillDetail,
  useRegistrySkillEntry,
  useRegistrySkills,
  useSkillContent,
  useSkillFiles,
  type RegistrySkillDetailArgs,
  type RegistrySkillsArgs,
  type SkillContentArgs,
  type SkillIdentityArgs,
} from "./skill-queries";
export {
  useDeleteSkill,
  useInstallRegistrySkill,
  type DeleteSkillArgs,
  type InstallRegistrySkillArgs,
} from "./skill-mutations";
