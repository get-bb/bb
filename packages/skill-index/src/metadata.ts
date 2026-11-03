import matter from "gray-matter";

export interface SkillMetadata {
  name: string | null;
  description: string | null;
  argumentHint: string | null;
  error: string | null;
}

export function parseSkillMetadata(content: string): SkillMetadata {
  const empty = { name: null, description: null, argumentHint: null };
  if (!/^\s*---\r?\n/u.test(content)) {
    return {
      ...empty,
      error: "SKILL.md frontmatter must start with a plain --- delimiter",
    };
  }
  try {
    const data: Record<string, unknown> = matter(content).data;
    const field = (key: string): string | null => {
      const value = data[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    return {
      name: field("name"),
      description: field("description"),
      argumentHint: field("argument-hint"),
      error: null,
    };
  } catch (error) {
    return {
      ...empty,
      error:
        error instanceof Error ? error.message : "Invalid SKILL.md frontmatter",
    };
  }
}
