import { execFileSync } from "node:child_process";

export function affectedPluginForks(root, base, forkable) {
  if (!base) return forkable;
  try {
    if (!/^[a-f0-9]{40,64}$/u.test(base)) throw new Error("Invalid base SHA");
    const paths = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
      {
        cwd: root,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 30_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    )
      .split("\0")
      .filter(Boolean);
    const selected = new Set();
    for (const path of paths) {
      const plugin = forkable.find((dir) => path.startsWith(`${dir}/`));
      if (plugin) selected.add(plugin);
      else return forkable;
    }
    return forkable.filter((dir) => selected.has(dir));
  } catch {
    console.error(
      "Could not determine changed plugins; checking all forkable plugins.",
    );
    return forkable;
  }
}
