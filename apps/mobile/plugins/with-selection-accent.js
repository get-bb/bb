const {
  AndroidConfig,
  withAndroidColors,
  withAndroidColorsNight,
  withAndroidStyles,
  withDangerousMod,
} = require("expo/config-plugins");
const { mkdir, writeFile } = require("node:fs/promises");
const path = require("node:path");

module.exports = function withSelectionAccent(config) {
  config = withDangerousMod(config, [
    "android",
    async (mod) => {
      const directory = path.join(
        mod.modRequest.platformProjectRoot,
        "app/src/main/res/drawable",
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "bb_insertion_handle.xml"),
        '<shape xmlns:android="http://schemas.android.com/apk/res/android" android:shape="rectangle"><size android:width="24dp" android:height="24dp"/><solid android:color="@android:color/transparent"/></shape>\n',
      );
      return mod;
    },
  ]);
  config = withAndroidColors(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: "selectionAccent",
      value: "#0b57d0",
    });
    return mod;
  });
  config = withAndroidColorsNight(config, (mod) => {
    mod.modResults = AndroidConfig.Colors.assignColorValue(mod.modResults, {
      name: "selectionAccent",
      value: "#a8c7fa",
    });
    return mod;
  });
  return withAndroidStyles(config, (mod) => {
    mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
      add: true,
      name: "android:textSelectHandle",
      value: "@drawable/bb_insertion_handle",
      parent: { name: "AppTheme" },
    });
    for (const name of ["colorAccent", "android:colorAccent"]) {
      mod.modResults = AndroidConfig.Styles.assignStylesValue(mod.modResults, {
        add: true,
        name,
        value: "@color/selectionAccent",
        parent: { name: "AppTheme" },
      });
    }
    return mod;
  });
};
