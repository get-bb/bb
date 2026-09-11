import { describe, expect, it } from "vitest";
import { createThreadRequestSchema, forkThreadRequestSchema, updateThreadPluginMetadataRequestSchema } from "../src/api/threads.js";
const base = { projectId: "project", origin: "plugin" as const, originPluginId: "plugin", input: [{ type: "text" as const, text: "start" }], environment: { type: "host" as const, hostId: "host", workspace: { type: "unmanaged" as const, path: null } } };
describe("plugin metadata contracts", () => {
  it("accepts one namespace on create and fork", () => { const metadata = { nested: [true] }; expect(createThreadRequestSchema.parse({ ...base, pluginMetadata: metadata }).pluginMetadata).toEqual(metadata); expect(forkThreadRequestSchema.parse({ sourceThreadId: "thread", origin: "plugin", originPluginId: "plugin", pluginMetadata: metadata }).pluginMetadata).toEqual(metadata); });
  it("validates patch keys", () => { expect(updateThreadPluginMetadataRequestSchema.parse({ pluginId: "p", set: { key: 1 }, remove: ["old"] })).toEqual({ pluginId: "p", set: { key: 1 }, remove: ["old"] }); expect(() => updateThreadPluginMetadataRequestSchema.parse({ pluginId: "p", remove: ["x", "x"] })).toThrow(); expect(() => updateThreadPluginMetadataRequestSchema.parse({ pluginId: "p", set: { x: 1 }, remove: ["x"] })).toThrow(); });
  it("requires plugin origin", () => { expect(() => createThreadRequestSchema.parse({ ...base, origin: "sdk", originPluginId: undefined, pluginMetadata: {} })).toThrow(); });
});
