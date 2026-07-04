import { asc, eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { createSkillBundleId } from "../ids.js";
import { skillBundles } from "../schema.js";

export interface SkillBundleStepData {
  text: string;
}

export interface SkillBundle {
  id: string;
  name: string;
  steps: SkillBundleStepData[];
  position: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateSkillBundleInput {
  name: string;
  steps: SkillBundleStepData[];
}

export interface UpdateSkillBundleInput {
  name: string;
  steps: SkillBundleStepData[];
}

type SkillBundleRow = typeof skillBundles.$inferSelect;

function parseSteps(row: Pick<SkillBundleRow, "id" | "steps">): SkillBundleStepData[] {
  const parsed = JSON.parse(row.steps) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`Invalid skill bundle steps for ${row.id}`);
  }
  return parsed.map((step, index) => {
    if (
      typeof step !== "object" ||
      step === null ||
      !("text" in step) ||
      typeof step.text !== "string"
    ) {
      throw new Error(`Invalid skill bundle step ${index} for ${row.id}`);
    }
    return { text: step.text };
  });
}

function toSkillBundle(row: SkillBundleRow): SkillBundle {
  return {
    id: row.id,
    name: row.name,
    steps: parseSteps(row),
    position: row.position,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function nextSkillBundlePosition(db: DbConnection): number {
  const row = db
    .select({ position: skillBundles.position })
    .from(skillBundles)
    .orderBy(asc(skillBundles.position))
    .all()
    .at(-1);
  return row ? row.position + 1 : 0;
}

export function listSkillBundles(db: DbConnection): SkillBundle[] {
  return db
    .select()
    .from(skillBundles)
    .orderBy(asc(skillBundles.position), asc(skillBundles.createdAt))
    .all()
    .map(toSkillBundle);
}

export function getSkillBundle(
  db: DbConnection,
  id: string,
): SkillBundle | null {
  const row =
    db.select().from(skillBundles).where(eq(skillBundles.id, id)).get() ?? null;
  return row ? toSkillBundle(row) : null;
}

export function createSkillBundle(
  db: DbConnection,
  input: CreateSkillBundleInput,
): SkillBundle {
  const now = Date.now();
  const row = db
    .insert(skillBundles)
    .values({
      id: createSkillBundleId(),
      name: input.name,
      steps: JSON.stringify(input.steps),
      position: nextSkillBundlePosition(db),
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toSkillBundle(row);
}

export function updateSkillBundle(
  db: DbConnection,
  id: string,
  input: UpdateSkillBundleInput,
): SkillBundle | null {
  const row =
    db
      .update(skillBundles)
      .set({
        name: input.name,
        steps: JSON.stringify(input.steps),
        updatedAt: Date.now(),
      })
      .where(eq(skillBundles.id, id))
      .returning()
      .get() ?? null;
  return row ? toSkillBundle(row) : null;
}

export function deleteSkillBundle(db: DbConnection, id: string): boolean {
  const deleted = db
    .delete(skillBundles)
    .where(eq(skillBundles.id, id))
    .returning({ id: skillBundles.id })
    .get();
  return deleted !== undefined;
}
