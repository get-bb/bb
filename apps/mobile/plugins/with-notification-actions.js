const {
  AndroidConfig,
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
} = require("expo/config-plugins");
const { mkdir, copyFile } = require("node:fs/promises");
const path = require("node:path");

module.exports = function withNotificationActions(config) {
  config = withAppBuildGradle(config, (mod) => {
    const dependency =
      'implementation("com.google.firebase:firebase-messaging:25.0.1")';
    if (!mod.modResults.contents.includes(dependency)) {
      const updated = mod.modResults.contents.replace(
        /dependencies\s*\{/,
        `dependencies {\n    ${dependency}`,
      );
      if (updated === mod.modResults.contents)
        throw new Error("Could not add the Firebase messaging dependency");
      mod.modResults.contents = updated;
    }
    return mod;
  });
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/java/app/getbb/notifications",
      );
      await mkdir(directory, { recursive: true });
      await copyFile(
        path.join(__dirname, "android/BbFirebaseMessagingService.kt"),
        path.join(directory, "BbFirebaseMessagingService.kt"),
      );
      return mod;
    },
  ]);
  return withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.$["xmlns:tools"] =
      "http://schemas.android.com/tools";
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    application.service ??= [];
    const names = new Set([
      "expo.modules.notifications.service.ExpoFirebaseMessagingService",
      "app.getbb.notifications.BbFirebaseMessagingService",
    ]);
    application.service = application.service.filter(
      (service) => !names.has(service.$["android:name"]),
    );
    application.service.push({
      $: {
        "android:name":
          "expo.modules.notifications.service.ExpoFirebaseMessagingService",
        "tools:node": "remove",
      },
    });
    application.service.push({
      $: {
        "android:name": "app.getbb.notifications.BbFirebaseMessagingService",
        "android:exported": "false",
      },
      "intent-filter": [
        {
          action: [
            { $: { "android:name": "com.google.firebase.MESSAGING_EVENT" } },
          ],
        },
      ],
    });
    return mod;
  });
};
