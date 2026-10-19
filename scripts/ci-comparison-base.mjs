import { execFileSync } from "node:child_process";

const [eventBase = "", pullRequestHead = ""] = process.argv.slice(2);
let base = eventBase;
if (pullRequestHead) {
  try {
    const [commit, firstParent, secondParent, ...rest] = execFileSync(
      "git",
      ["rev-list", "--parents", "-n", "1", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    )
      .trim()
      .split(/\s+/u);
    if (
      commit &&
      firstParent &&
      secondParent === pullRequestHead &&
      rest.length === 0
    )
      base = firstParent;
  } catch {}
}
process.stdout.write(`${base}\n`);
