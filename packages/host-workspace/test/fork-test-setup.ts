// bb-fork(windows): the suites assert Git's stock behavior, but a host can set
// `diff.renames=false`, a tiny `diff.renameLimit`, or `core.autocrlf=true`
// globally or system-wide, which changes diff output and breaks rename
// assertions. Ignore both config scopes so every Git child this package spawns
// sees only repo-local and command-line config, matching CI.
export {};

process.env.GIT_CONFIG_GLOBAL =
  process.platform === "win32" ? "NUL" : "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
