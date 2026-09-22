import { describe, expect, it } from "vitest";
import {
  parseLinuxBrowserApplication,
  parseMacBrowserApplication,
} from "../src/browser-import/browser-applications.js";

describe("browser application registration", () => {
  it("requires both web schemes on macOS and retains exact application identities", () => {
    const info = {
      CFBundleName: "Unlisted Browser",
      CFBundleExecutable: "unlisted",
      CFBundleIdentifier: "org.example.unlisted",
      CrProductDirName: "Vendor/Unlisted",
      CFBundleURLTypes: [
        { CFBundleURLSchemes: ["http"] },
        { CFBundleURLSchemes: ["https"] },
      ],
    };
    expect(
      parseMacBrowserApplication(JSON.stringify(info), "Unlisted Browser"),
    ).toEqual(["unlisted browser", "unlisted", "org.example.unlisted"]);
    for (const schemes of [["mailto"], ["unlisted"], ["http"]]) {
      expect(
        parseMacBrowserApplication(
          JSON.stringify({
            ...info,
            CFBundleURLTypes: [{ CFBundleURLSchemes: schemes }],
          }),
          "Unlisted Browser",
        ),
      ).toBeUndefined();
    }
    expect(parseMacBrowserApplication("not json", "Browser")).toBeUndefined();
    expect(
      parseMacBrowserApplication('{"CFBundleURLTypes":42}', "Browser"),
    ).toBeUndefined();
  });

  it("requires a Linux web-browser registration rather than an application name or action", () => {
    const entry =
      "[Desktop Entry]\nType=Application\nName=Unlisted Browser\nCategories=Network;WebBrowser;\nMimeType=x-scheme-handler/http;x-scheme-handler/https;\nStartupWMClass=unlisted\nX-Flatpak=org.example.unlisted\nX-SnapInstanceName=unlisted\n";
    expect(parseLinuxBrowserApplication(entry, "org.example.unlisted")).toEqual(
      ["org.example.unlisted", "unlisted browser", "unlisted"],
    );
    for (const invalid of [
      entry.replace("WebBrowser;", "Email;"),
      entry.replace("x-scheme-handler/https;", ""),
      entry.replace("Type=Application", "Type=Link"),
      `${entry}Hidden=true\n`,
      entry.replace("[Desktop Entry]", "[Desktop Action Browser]"),
    ])
      expect(parseLinuxBrowserApplication(invalid, "Browser")).toBeUndefined();
  });
});
