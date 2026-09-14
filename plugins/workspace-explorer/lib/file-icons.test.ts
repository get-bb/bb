import { describe, expect, it } from "vitest";
import {
  File01Icon,
  FileBracesIcon,
  FileCodeIcon,
  FileImageIcon,
  FileSpreadsheetIcon,
  FileTerminalIcon,
  FileZipIcon,
  TextIcon,
} from "@hugeicons/core-free-icons";
import { fileIconForPath } from "./file-icons.js";

describe("fileIconForPath", () => {
  it("maps extensions to typed icons", () => {
    expect(fileIconForPath("screenshot.png")).toBe(FileImageIcon);
    expect(fileIconForPath("photo.JPG")).toBe(FileImageIcon);
    expect(fileIconForPath("bundle.js")).toBe(FileCodeIcon);
    expect(fileIconForPath("config.yaml")).toBe(FileBracesIcon);
    expect(fileIconForPath("data.csv")).toBe(FileSpreadsheetIcon);
    expect(fileIconForPath("archive.tar.gz")).toBe(FileZipIcon);
    expect(fileIconForPath("run.sh")).toBe(FileTerminalIcon);
    expect(fileIconForPath("README.md")).toBe(TextIcon);
  });

  it("falls back for unknown extensions, dotfiles, and bare names", () => {
    expect(fileIconForPath("mystery.zzz")).toBe(File01Icon);
    expect(fileIconForPath(".gitignore")).toBe(File01Icon);
    expect(fileIconForPath("Makefile")).toBe(File01Icon);
  });
});
