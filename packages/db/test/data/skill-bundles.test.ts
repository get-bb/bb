import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import {
  createSkillBundle,
  deleteSkillBundle,
  getSkillBundle,
  listSkillBundles,
  updateSkillBundle,
} from "../../src/data/skill-bundles.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  return db;
}

describe("skill bundles", () => {
  it("creates and lists bundles in position order", () => {
    const db = setup();

    const first = createSkillBundle(db, {
      name: "Cleanup",
      description: null,
      steps: [{ text: "/simplify" }, { text: "/review" }],
    });
    const second = createSkillBundle(db, {
      name: "Consistency",
      description: "Run consistency checks",
      steps: [{ text: "/ensure-consistency" }],
    });

    expect(first.id).toMatch(/^sbun_/);
    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(listSkillBundles(db).map((bundle) => bundle.id)).toEqual([
      first.id,
      second.id,
    ]);
  });

  it("updates and deletes bundles", () => {
    const db = setup();
    const created = createSkillBundle(db, {
      name: "Draft",
      description: null,
      steps: [{ text: "/simplify" }],
    });

    const updated = updateSkillBundle(db, created.id, {
      name: "Review",
      description: "Review sequence",
      steps: [{ text: "/review" }, { text: "Summarize the findings." }],
    });

    expect(updated).toMatchObject({
      id: created.id,
      name: "Review",
      description: "Review sequence",
      steps: [{ text: "/review" }, { text: "Summarize the findings." }],
    });
    expect(getSkillBundle(db, created.id)?.name).toBe("Review");
    expect(deleteSkillBundle(db, created.id)).toBe(true);
    expect(getSkillBundle(db, created.id)).toBeNull();
    expect(deleteSkillBundle(db, created.id)).toBe(false);
  });
});
