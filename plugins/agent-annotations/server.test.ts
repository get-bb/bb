import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { AnnotationRecord } from "./annotations.js";
import plugin from "./server.js";

const record: AnnotationRecord = {
  id: "mfx12abc",
  number: 1,
  comment: "Make this green",
  url: "http://localhost:5173/checkout",
  title: "Checkout",
  viewport: { width: 1280, height: 720 },
  element: {
    tagName: "button",
    name: 'button#pay "Pay now"',
    selector: "#pay",
    text: "Pay",
    attributes: { id: "pay" },
    rect: { x: 40, y: 300, width: 120, height: 36 },
    styles: {},
  },
  components: [{ name: "SubmitButton", source: "src/SubmitButton.tsx:12" }],
};

async function setup() {
  const { bb, harness } = createFakePluginHost({
    pluginId: "agent-annotations",
  });
  await plugin(bb);
  const provider = harness.registrations.mentionProviders.find(
    (candidate) => candidate.id === "annotation",
  );
  if (provider === undefined) {
    throw new Error("Expected the annotation mention provider.");
  }
  return { harness, provider };
}

describe("agent annotations server", () => {
  it("stores saved annotations and resolves them as agent context", async () => {
    const { harness, provider } = await setup();

    const { id } = z
      .object({ id: z.string().min(1) })
      .parse(await harness.callRpc("save", record));
    expect(id).toBe(record.id);
    await harness.callRpc("update", { id, comment: "Make this blue" });
    const resolved = await provider.resolve(id);

    expect(resolved.context).toContain("# Browser annotation 1");
    expect(resolved.context).toContain("Make this blue");
    expect(resolved.context).not.toContain("Make this green");
    expect(resolved.context).toContain(
      "SubmitButton (src/SubmitButton.tsx:12)",
    );
    await expect(provider.resolve("missing")).rejects.toThrow(
      "This browser annotation is no longer available",
    );
  });

  it("rejects updates to missing annotations and blank edits", async () => {
    const { harness } = await setup();
    await expect(
      harness.callRpc("update", { id: "missing", comment: "Updated" }),
    ).rejects.toThrow();
    await harness.callRpc("save", record);
    await expect(
      harness.callRpc("update", { id: record.id, comment: " " }),
    ).rejects.toThrow();
  });

  it("rejects malformed annotations at the rpc boundary", async () => {
    const { harness } = await setup();

    await expect(
      harness.callRpc("save", { ...record, comment: "   " }),
    ).rejects.toThrow();
  });
});
