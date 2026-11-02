import { execPortableFile } from "./exec-portable-file.js";
import {
  execHostFile,
  execHostFileBuffer,
  execHostFileCallback,
  forkHostProcess,
  spawnHostProcess,
} from "./host-process.js";
import { spawnManagedProcess } from "./managed-process.js";
import { withProcessOwner, type ProcessOwner } from "./process-owner.js";
import {
  spawnPortableOutputProcess,
  spawnPortablePipedProcess,
  spawnPortableProcess,
} from "./spawn.js";

export interface OwnedProcesses {
  spawnHostProcess: typeof spawnHostProcess;
  forkHostProcess: typeof forkHostProcess;
  execHostFile: typeof execHostFile;
  execHostFileBuffer: typeof execHostFileBuffer;
  execHostFileCallback: typeof execHostFileCallback;
  spawnPortableProcess: typeof spawnPortableProcess;
  spawnPortablePipedProcess: typeof spawnPortablePipedProcess;
  spawnPortableOutputProcess: typeof spawnPortableOutputProcess;
  spawnManagedProcess: typeof spawnManagedProcess;
  execPortableFile: typeof execPortableFile;
}

function ownedBy<TStart extends (...args: never[]) => unknown>(
  owner: ProcessOwner,
  start: TStart,
): TStart {
  const owned = (...args: Parameters<TStart>) =>
    withProcessOwner(owner, () => start(...args));
  return owned as unknown as TStart;
}

export function processesOwnedBy(owner: ProcessOwner): OwnedProcesses {
  return {
    spawnHostProcess: ownedBy(owner, spawnHostProcess),
    forkHostProcess: ownedBy(owner, forkHostProcess),
    execHostFile: ownedBy(owner, execHostFile),
    execHostFileBuffer: ownedBy(owner, execHostFileBuffer),
    execHostFileCallback: ownedBy(owner, execHostFileCallback),
    spawnPortableProcess: ownedBy(owner, spawnPortableProcess),
    spawnPortablePipedProcess: ownedBy(owner, spawnPortablePipedProcess),
    spawnPortableOutputProcess: ownedBy(owner, spawnPortableOutputProcess),
    spawnManagedProcess: ownedBy(owner, spawnManagedProcess),
    execPortableFile: (command, args, options) =>
      execPortableFile(command, args, { ...options, owner }),
  };
}
