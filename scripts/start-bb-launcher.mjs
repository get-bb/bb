import { runNativeModulePreflight } from "./start-bb.mjs";

const { runBbApp, runLauncherEntry } =
  await import("../packages/bb-app/src/launcher.ts");

runLauncherEntry(() =>
  runBbApp(process.argv.slice(2), {
    beforeServerStart: () => runNativeModulePreflight({ checkOnly: true }),
    worktreePolicy: null,
  }),
);
