import { describe, expect, it } from "vitest";
import { parseCodeWorkspaceFolders } from "../../../src/services/projects/code-workspace.js";

describe("parseCodeWorkspaceFolders", () => {
  it("reads VS Code's lenient JSON with comments, trailing commas and a BOM", () => {
    const text = `\uFEFF{
  // the folders
  "folders": [
    { "path": "." },
    /* sibling */ { "name": "API", "path": "../api", },
    { "path": "https://example.com/not//a/comment" },
  ],
  "settings": { "files.exclude": { "**/.git": true, }, },
}`;
    expect(parseCodeWorkspaceFolders(text)).toEqual([
      { kind: "path", path: "." },
      { kind: "path", path: "../api" },
      { kind: "path", path: "https://example.com/not//a/comment" },
    ]);
  });

  it("turns file URIs into paths and reports other URI schemes", () => {
    expect(
      parseCodeWorkspaceFolders(
        JSON.stringify({
          folders: [
            { uri: "file:///Users/me/My%20Repo" },
            { uri: "file:///c%3A/work/api" },
            { uri: "file://localhost/srv/docs" },
            { uri: "vscode-remote://ssh-remote+box/home/me/app" },
            { uri: "file://server/share/app" },
            { name: "empty" },
          ],
        }),
      ),
    ).toEqual([
      { kind: "path", path: "/Users/me/My Repo" },
      { kind: "path", path: "c:/work/api" },
      { kind: "path", path: "/srv/docs" },
      {
        kind: "unsupported-uri",
        uri: "vscode-remote://ssh-remote+box/home/me/app",
      },
      { kind: "unsupported-uri", uri: "file://server/share/app" },
      { kind: "invalid", entry: "folders[5]" },
    ]);
  });

  it("reports a malformed folder entry without rejecting the rest of the file", () => {
    expect(
      parseCodeWorkspaceFolders(
        '{ "folders": [{ "path": 5 }, "api", { "path": "../web" }] }',
      ),
    ).toEqual([
      { kind: "invalid", entry: "folders[0]" },
      { kind: "invalid", entry: "folders[1]" },
      { kind: "path", path: "../web" },
    ]);
  });

  it("rejects files that are not workspace JSON", () => {
    expect(parseCodeWorkspaceFolders("not json")).toBeNull();
    expect(parseCodeWorkspaceFolders('{"folders": "nope"}')).toBeNull();
    expect(parseCodeWorkspaceFolders("{}")).toEqual([]);
  });
});
