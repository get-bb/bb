import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { firstPerIdentity, scanSkillFiles } from "../src/index.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("indexes linked roots, bundles and files once by content while retaining registrations and bounding project links", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-index-"));
  roots.push(root);
  const workspace = path.join(root, "workspace");
  const pool = path.join(root, "pool");
  const skills = path.join(workspace, ".agents", "skills");
  await mkdir(path.join(pool, "review"), { recursive: true });
  await mkdir(skills, { recursive: true });
  const content =
    "---\nname: review\ndescription: Review changes\n---\nUse the checklist.\n";
  const file = path.join(pool, "review", "SKILL.md");
  await writeFile(file, content);
  await symlink(pool, path.join(root, "linked-root"));
  await symlink(pool, path.join(pool, "loop"));
  await symlink(path.join(pool, "review"), path.join(skills, "review"));
  await mkdir(path.join(skills, "file-link"));
  await symlink(file, path.join(skills, "file-link", "SKILL.md"));
  await mkdir(path.join(skills, "copy"));
  await writeFile(path.join(skills, "copy", "SKILL.md"), content);
  const linked = await scanSkillFiles({
    path: path.join(root, "linked-root"),
    shape: "skill-recursive",
    boundaryPath: null,
  });
  expect(linked).toHaveLength(1);
  expect(linked[0]).toMatchObject({
    realPath: await realpath(file),
    linked: true,
  });
  const registrations = await scanSkillFiles({
    path: skills,
    shape: "skill",
    boundaryPath: null,
  });
  expect(registrations).toHaveLength(3);
  expect(
    firstPerIdentity(registrations, (entry) => entry.contentSha256),
  ).toHaveLength(1);
  const project = await scanSkillFiles({
    path: skills,
    shape: "skill-recursive",
    boundaryPath: workspace,
  });
  expect(project.map((entry) => entry.name)).toEqual(["copy"]);
  await mkdir(path.join(workspace, ".claude", "commands"), { recursive: true });
  await symlink(
    path.join(skills, "copy", "SKILL.md"),
    path.join(workspace, ".claude", "commands", "review.md"),
  );
  await symlink(file, path.join(workspace, ".claude", "commands", "escape.md"));
  const commands = await scanSkillFiles({
    path: path.join(workspace, ".claude", "commands"),
    shape: "command",
    boundaryPath: workspace,
  });
  expect(commands.map((entry) => entry.name)).toEqual(["review"]);
});

it("lists every skill directory without charging its contents to the shared traversal budget", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "skill-index-"));
  roots.push(root);
  for (const name of ["alpha", "beta", "gamma"]) {
    await mkdir(path.join(root, name));
    await writeFile(path.join(root, name, "SKILL.md"), name);
    for (const file of ["one.md", "two.md", "three.md"]) {
      await writeFile(path.join(root, name, file), "");
    }
  }
  const skills = await scanSkillFiles(
    { path: root, shape: "skill", boundaryPath: null },
    { remainingEntries: 2 },
  );
  expect(skills.map((skill) => skill.name)).toEqual(["alpha", "beta", "gamma"]);
});
