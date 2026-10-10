import { execFileSync } from "node:child_process";

const base = process.argv[2];
let required = true;
if (base) {
  try {
    const paths = execFileSync(
      "git",
      ["diff", "--name-only", "--no-renames", "-z", base, "HEAD", "--"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    ).split("\0");
    required = paths.some((path) =>
      /(?:^|\/)package\.json$|(?:^|\/)\.npmrc$|^pnpm-(?:lock|workspace)\.yaml$|^\.pnpmfile\.cjs$|^patches\//u.test(
        path,
      ),
    );
  } catch {
    required = true;
  }
}
process.stdout.write(`${required}\n`);
