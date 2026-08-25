/**
 * What a known agent's native-root resolver receives and answers.
 *
 * The plugin's host entry runs on the machine the agent is installed on and
 * answers `resolveNativeRoots` for one agent and one workspace. Everything
 * host-local comes in through these arguments — the home directory and the
 * environment included — so a resolver never reads `process.env` itself and
 * a test can hand it a fixture home.
 */

import type { ExperimentalNativeRootsResolveAnswer } from "@get-bb/plugin-sdk/host";

export type AcpNativeRootsEnvironment = Readonly<
  Record<string, string | undefined>
>;

export interface AcpNativeRootsResolverArgs {
  /** The workspace, or null when bb lists without one (user roots only). */
  cwd: string | null;
  /** The host user's home directory. */
  homeDir: string;
  /** The host process environment. */
  env: AcpNativeRootsEnvironment;
}

/** One root a resolver answers (the contract's input form). */
export type AcpResolvedSkillRoot = NonNullable<
  ExperimentalNativeRootsResolveAnswer["skills"]
>[number];

export type AcpNativeRootsResolver = (
  args: AcpNativeRootsResolverArgs,
) => Promise<ExperimentalNativeRootsResolveAnswer>;
