import { readFile, rename, unlink, writeFile } from "node:fs/promises";

export function createRenameFailingFileSystem(failOnCall) {
  let renameCalls = 0;

  return {
    fileSystem: {
      readFile,
      rename: async (from, to) => {
        renameCalls += 1;

        if (renameCalls === failOnCall) {
          throw new Error("simulated rename failure");
        }

        await rename(from, to);
      },
      unlink,
      writeFile,
    },
    getRenameCalls: () => renameCalls,
  };
}
