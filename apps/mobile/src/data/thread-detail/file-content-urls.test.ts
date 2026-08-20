import { describe, expect, it } from "vitest";
import {
  resolveAssistantImageUrl,
  resolveUserAttachmentImageUrl,
} from "./file-content-urls";

const ctx = {
  projectId: "p 1",
  threadId: "t/1",
  serverUrl: "https://h.example/",
};

describe("resolveUserAttachmentImageUrl", () => {
  it("passes web and data URLs through untouched", () => {
    expect(resolveUserAttachmentImageUrl("https://x/y.png", ctx)).toBe(
      "https://x/y.png",
    );
    expect(resolveUserAttachmentImageUrl("data:image/png;base64,AA", ctx)).toBe(
      "data:image/png;base64,AA",
    );
  });

  it("sends project-relative paths to the attachment route with encoded params", () => {
    expect(resolveUserAttachmentImageUrl("up/a b.png", ctx)).toBe(
      "https://h.example/api/v1/projects/p%201/attachments/content?path=up%2Fa%20b.png",
    );
  });

  it("sends absolute host paths (also file://) to the host-files route", () => {
    expect(resolveUserAttachmentImageUrl("/tmp/s.png", ctx)).toBe(
      "https://h.example/api/v1/threads/t%2F1/host-files/content?path=%2Ftmp%2Fs.png",
    );
    expect(resolveUserAttachmentImageUrl("file:///tmp/s.png", ctx)).toBe(
      "https://h.example/api/v1/threads/t%2F1/host-files/content?path=%2Ftmp%2Fs.png",
    );
    expect(resolveUserAttachmentImageUrl("C:\\img\\s.png", ctx)).toContain(
      "host-files/content?path=C%3A%5Cimg%5Cs.png",
    );
  });

  it("cannot place a relative path without a project, nor UNC paths", () => {
    expect(
      resolveUserAttachmentImageUrl("up/a.png", { ...ctx, projectId: null }),
    ).toBeNull();
    expect(resolveUserAttachmentImageUrl("\\\\server\\a.png", ctx)).toBeNull();
  });
});

describe("resolveAssistantImageUrl", () => {
  it("resolves absolute and workspace-relative paths through the host-files route", () => {
    expect(
      resolveAssistantImageUrl("/repo/out.png", "t1", "/repo", "http://h"),
    ).toBe(
      "http://h/api/v1/threads/t1/host-files/content?path=%2Frepo%2Fout.png",
    );
    expect(
      resolveAssistantImageUrl("./docs/out.png", "t1", "/repo/", "http://h"),
    ).toBe(
      "http://h/api/v1/threads/t1/host-files/content?path=%2Frepo%2Fdocs%2Fout.png",
    );
  });

  it("leaves web URLs alone and refuses relative paths without a root or foreign schemes", () => {
    expect(
      resolveAssistantImageUrl("https://x/y.png", "t1", "/r", "http://h"),
    ).toBe("https://x/y.png");
    expect(
      resolveAssistantImageUrl("docs/out.png", "t1", undefined, "http://h"),
    ).toBeNull();
    expect(
      resolveAssistantImageUrl("blob:abc", "t1", "/r", "http://h"),
    ).toBeNull();
  });
});
