const { withXcodeProject } = require("@expo/config-plugins");
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const { join } = require("node:path");

module.exports = (config) =>
  withXcodeProject(config, (modConfig) => {
    const target = join(
      modConfig.modRequest.platformProjectRoot,
      "ShareExtension",
      "ShareViewController.swift",
    );
    if (!existsSync(target)) {
      throw new Error(
        "expo-share-intent did not generate its iOS share target",
      );
    }
    const groupIdentifier =
      modConfig.ios?.entitlements?.[
        "com.apple.security.application-groups"
      ]?.[0] ?? "group.app.getbb.mobile.shared";
    const scheme = modConfig.scheme;
    if (!scheme)
      throw new Error("The iOS share extension requires an app scheme");
    const source = readFileSync(
      join(__dirname, "ShareViewController.swift"),
      "utf8",
    )
      .replaceAll("<GROUPIDENTIFIER>", groupIdentifier)
      .replaceAll("<SCHEME>", scheme);
    writeFileSync(target, source);
    return modConfig;
  });
