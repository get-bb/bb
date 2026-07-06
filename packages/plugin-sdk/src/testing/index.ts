/**
 * `@bb/plugin-sdk/testing` — the backend plugin test harness: a fake BB
 * plugin host (`createFakePluginHost`) whose `bb` satisfies `BbPluginApi`,
 * plus fixtures. Workspace/in-repo consumers only for V1: this subpath is
 * not part of the bundled `.d.ts` scaffolded plugins receive.
 *
 * The frontend harness (loadPluginApp/renderSlot) lives at
 * `@bb/plugin-sdk/testing/app` so backend-only tests never load React.
 */
export {
  createFakePluginHost,
  PluginContextStaleError,
  type CreateFakePluginHostOptions,
  type FakeAgentToolRecord,
  type FakeCliRecord,
  type FakeHttpRouteRecord,
  type FakeLogEntry,
  type FakeLogLevel,
  type FakeMentionProviderRecord,
  type FakePluginHarness,
  type FakePluginHost,
  type FakePluginRegistrations,
  type FakeRealtimeSignal,
  type FakeScheduleRecord,
  type FakeServiceRecord,
  type FakeThreadActionRecord,
} from "./fake-plugin-host.js";
export {
  createFakeSdk,
  type FakeSdkCall,
  type FakeSdkHarness,
  type FakeSdkOverrides,
} from "./fake-sdk.js";
export { makeThreadResponse } from "./fixtures.js";
