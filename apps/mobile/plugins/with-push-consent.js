const { AndroidConfig, withAndroidManifest } = require("expo/config-plugins");

module.exports = function withPushConsent(config) {
  return withAndroidManifest(config, (mod) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(
      mod.modResults,
    );
    for (const name of [
      "firebase_messaging_auto_init_enabled",
      "firebase_analytics_collection_enabled",
    ]) {
      AndroidConfig.Manifest.addMetaDataItemToMainApplication(
        application,
        name,
        "false",
      );
    }
    return mod;
  });
};
