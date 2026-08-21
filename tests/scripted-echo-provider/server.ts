import type { BbPluginApi } from "@get-bb/plugin-sdk";

/**
 * The manifest requires a server entry, but this plugin is a test harness:
 * the suites that run it register the fake provider declarations themselves
 * (`registerFakeProviders` in the server test helpers), so there is nothing
 * for the entry to do.
 */
export default function scriptedEchoProvider(_bb: BbPluginApi): void {}
