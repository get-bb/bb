import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    full: { type: "boolean", default: false },
    base: { type: "string" },
    affected: { type: "string" },
  },
});
const shards = JSON.parse(readFileSync("scripts/ci-test-shards.json", "utf8"));
const full = {
  tests: { include: shards.tests },
  "windows-tests": { include: shards["windows-tests"] },
  foundation: true,
  packaging: true,
  providers: true,
  forks: true,
  buildFilters: "",
  staticFilters: "",
  buildNeeded: true,
  staticNeeded: true,
  appBuild: true,
  sdkBuild: true,
  reason: "Full cross-platform coverage",
};

function matchesFilter(name, filter) {
  const patterns = filter.split(/\s+/u).map((part) => {
    if (!part.startsWith("--filter=")) throw new Error("Unsupported CI filter");
    return part.slice(9).replaceAll("'", "");
  });
  const match = (pattern) =>
    new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
        .join(".*")}$`,
      "u",
    ).test(name);
  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));
  return (
    (positive.length === 0 || positive.some(match)) &&
    !patterns.some(
      (pattern) => pattern.startsWith("!") && match(pattern.slice(1)),
    )
  );
}

function select() {
  if (values.full) return full;
  if (!values.base || !values.affected)
    throw new Error("Missing change evidence");
  const paths = execFileSync(
    "git",
    ["diff", "--name-only", "--no-renames", "-z", values.base, "HEAD", "--"],
    { encoding: "utf8", timeout: 30_000, maxBuffer: 16 * 1024 * 1024 },
  )
    .split("\0")
    .filter(Boolean);
  const known = /^(?:apps|packages|plugins|examples\/plugins|tests)\//u;
  if (paths.some((path) => !known.test(path))) return full;
  const result = JSON.parse(readFileSync(values.affected, "utf8"));
  const items = result?.data?.affectedTasks?.items;
  if (!Array.isArray(items) || result.errors?.length)
    throw new Error("Invalid Turbo change query");
  const tasks = items.map((item) => {
    if (
      typeof item?.name !== "string" ||
      typeof item?.package?.name !== "string" ||
      (!/^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/u.test(item.package.name) &&
        item.package.name !== "//")
    )
      throw new Error("Invalid affected task");
    return { name: item.name, package: item.package.name };
  });
  if (paths.length > 0 && tasks.length === 0)
    throw new Error("Changed files without affected tasks");
  const tests = new Set(
    tasks.filter((task) => task.name === "test").map((task) => task.package),
  );
  const packagesFor = (names) =>
    [
      ...new Set(
        tasks
          .filter((task) => names.includes(task.name))
          .map((task) => task.package),
      ),
    ].filter((name) => name !== "//");
  const buildPackages = packagesFor(["build"]);
  const staticPackages = packagesFor(["lint", "typecheck"]);
  const filtersFor = (packages) =>
    packages
      .sort()
      .map((name) => `--filter=${name}`)
      .join(" ");
  const uiOnly = paths.every((path) =>
    /^(?:apps\/(?:app|web)\/(?:src|public)\/|packages\/(?:core-ui|shared-ui|thread-view|client-core|mobile-bridge)\/(?:src|test|tests)\/)/u.test(
      path,
    ),
  );
  const appOnly = paths.every((path) =>
    /^apps\/(?:app|web)\/(?:src|public)\//u.test(path),
  );
  const packaging = paths.some((path) =>
    /^(?:apps\/(?:desktop\/|app\/(?:vite\.config|scripts\/|package\.json))|packages\/(?:bb-app|server-archive|plugin-build|bundled-plugins|plugin-sdk|sdk|templates)\/)/u.test(
      path,
    ),
  );
  const matrix = (entries) => ({
    include: entries.flatMap((entry) => {
      const selected = [...tests].filter((name) =>
        matchesFilter(name, entry.filter),
      );
      return selected.length === 0
        ? []
        : [
            {
              ...entry,
              filter: selected
                .sort()
                .map((name) => `--filter=${name}`)
                .join(" "),
            },
          ];
    }),
  });
  return {
    tests: matrix(shards.tests),
    "windows-tests": uiOnly ? { include: [] } : matrix(shards["windows-tests"]),
    foundation:
      !uiOnly &&
      shards.foundation.some((name) =>
        tasks.some((task) => task.package === name),
      ),
    packaging,
    providers: paths.some((path) =>
      /^(?:plugins\/provider-|packages\/(?:agent-runtime|provider-bridge-))/u.test(
        path,
      ),
    ),
    forks:
      !appOnly && tasks.some((task) => task.package.startsWith("bb-plugin-")),
    buildNeeded: buildPackages.length > 0,
    staticNeeded: staticPackages.length > 0,
    appBuild: tasks.some(
      (task) => task.package === "@bb/app" && task.name === "build",
    ),
    sdkBuild: tasks.some(
      (task) => task.package === "@get-bb/plugin-sdk" && task.name === "build",
    ),
    buildFilters: filtersFor(buildPackages),
    staticFilters: filtersFor(staticPackages),
    reason: `Affected checks for ${paths.length} changed paths`,
  };
}

try {
  process.stdout.write(`${JSON.stringify(select())}\n`);
} catch (error) {
  console.error(
    `Change selection unavailable; running full CI: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.stdout.write(`${JSON.stringify(full)}\n`);
}
