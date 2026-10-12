import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { createProjectHandoff } from "./handoff.js";

const USAGE = "Usage: bb project-handoff export <project-id>";

export default function plugin(bb: BbPluginApi) {
  bb.cli.register({
    name: "project-handoff",
    summary: "Export a Markdown project handoff brief",
    commands: [
      {
        name: "export",
        summary: "Print sources and up to 100 active threads",
        usage: USAGE,
      },
    ],
    async run(argv) {
      if (argv.length === 0 || argv[0] === "--help" || argv[0] === "help") {
        return { exitCode: 0, stdout: USAGE };
      }
      const [command, projectId] = argv;
      if (command !== "export" || !projectId || argv.length !== 2) {
        return { exitCode: 1, stderr: USAGE };
      }
      try {
        return {
          exitCode: 0,
          stdout: await createProjectHandoff(bb.sdk, projectId),
        };
      } catch (error) {
        return {
          exitCode: 1,
          stderr: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
}
