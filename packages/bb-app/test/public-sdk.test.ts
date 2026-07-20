import { describe, expect, it } from "vitest";
import { BBSdk } from "../src/public-sdk.js";

describe("bb-app public SDK", () => {
  it("exposes every canonical SDK area instead of a narrowed duplicate", () => {
    const sdk = new BBSdk({
      baseUrl: "http://bb.test",
      fetch: async () => new Response("{}"),
    });

    expect(typeof sdk.files.read).toBe("function");
    expect(typeof sdk.plugins.callRpc).toBe("function");
    expect(typeof sdk.projects.attachments.upload).toBe("function");
    expect(typeof sdk.skills.list).toBe("function");
    expect(typeof sdk.system.config).toBe("function");
    expect(typeof sdk.terminals.rename).toBe("function");
    expect(typeof sdk.threadSections.create).toBe("function");
    expect(typeof sdk.threads.queuedMessages.create).toBe("function");
    expect(typeof sdk.threads.queuedMessages.update).toBe("function");
    expect(typeof sdk.environments.mergePullRequest).toBe("function");
  });
});
