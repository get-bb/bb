import type { SkillSummary } from "@bb/server-contract";

export interface SkillGroup {
  key: string;
  primary: SkillSummary;
  members: readonly SkillSummary[];
}

function skillGroupKey(skill: SkillSummary): string {
  return skill.contentHash === null
    ? skill.id
    : `${skill.name}\u0000${skill.contentHash}`;
}

export function groupIdenticalSkills(
  skills: readonly SkillSummary[],
): SkillGroup[] {
  const membersByKey = new Map<string, SkillSummary[]>();
  for (const skill of skills) {
    const key = skillGroupKey(skill);
    const members = membersByKey.get(key);
    if (members === undefined) {
      membersByKey.set(key, [skill]);
    } else {
      members.push(skill);
    }
  }
  return [...membersByKey].map(([key, members]) => ({
    key,
    primary: members.find((skill) => skill.manageable) ?? members[0],
    members,
  }));
}

export function findSkillGroup(
  skills: readonly SkillSummary[],
  skill: SkillSummary,
): readonly SkillSummary[] {
  const key = skillGroupKey(skill);
  return skills.filter((candidate) => skillGroupKey(candidate) === key);
}
