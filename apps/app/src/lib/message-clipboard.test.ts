// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readMessageClipboardHtml } from "./message-clipboard";

describe("message clipboard boundary", () => {
  it.each([
    '{"version":2,"text":"A photo","imageUrl":"http://localhost/photo.png"}',
    '{"version":1,"text":"A photo","imageUrl":"https://other.example/photo.png"}',
    '{"version":1,"text":"A photo","imageUrl":"file:///photo.png"}',
    '{"version":1,"text":"A photo","imageUrl":"http://user:password@localhost/photo.png"}',
    '{"version":1,"text":"A photo","imageUrl":"http://localhost/photo.png","unexpected":true}',
    "{malformed",
  ])("ignores unsupported or unsafe metadata: %s", (metadata) => {
    metadata = metadata.replaceAll(
      "http://localhost/photo.png",
      new URL("/photo.png", window.location.href).href,
    );
    const credentialUrl = new URL("/photo.png", window.location.href);
    credentialUrl.username = "user";
    credentialUrl.password = "password";
    metadata = metadata.replace(
      "http://user:password@localhost/photo.png",
      credentialUrl.href,
    );
    const element = document.createElement("meta");
    element.name = "bb-message";
    element.content = metadata;
    expect(readMessageClipboardHtml(element.outerHTML)).toBeNull();
  });
});
