/** Host-local executable discovery and child environments shared with core. */
export { hostToolchain as experimental_hostToolchain } from "@bb/process-utils";

/** Spawn with refreshed executable discovery, PATH, and Windows shim handling. */
export {
  spawnHostProcess as experimental_spawnHostProcess,
  forkHostProcess as experimental_forkHostProcess,
  execHostFile as experimental_execHostFile,
  execHostFileCallback as experimental_execHostFileCallback,
} from "@bb/process-utils";
