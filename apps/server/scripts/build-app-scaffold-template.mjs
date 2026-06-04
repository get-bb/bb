import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import {
  appScaffoldTemplateDigestPath,
  appScaffoldTemplateSourcePath,
  computeAppScaffoldTemplateDigest,
} from "./app-scaffold-template-digest.mjs";

// Rebuilds the app scaffold template's committed public/ tree from source/
// (the template build typechecks via tsc --noEmit before vite builds), then
// records the source/public digest that the drift test
// (test/public/app-scaffold-template-drift.test.ts) verifies.
function runInTemplateSource(args) {
  execFileSync("pnpm", ["--ignore-workspace", ...args], {
    cwd: appScaffoldTemplateSourcePath,
    stdio: "inherit",
  });
}

runInTemplateSource(["install", "--frozen-lockfile"]);
runInTemplateSource(["run", "build"]);

writeFileSync(
  appScaffoldTemplateDigestPath,
  `${JSON.stringify(computeAppScaffoldTemplateDigest(), null, 2)}\n`,
);
console.log(
  `Rebuilt app scaffold template public/ and recorded ${path.relative(
    process.cwd(),
    appScaffoldTemplateDigestPath,
  )}`,
);
