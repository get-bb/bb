const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

module.exports = ({ config }) => {
  const variant = process.env.BB_MOBILE_VARIANT ?? "production";
  if (variant !== "production" && variant !== "dev") {
    throw new Error("BB_MOBILE_VARIANT must be production or dev");
  }
  const isDev = variant === "dev";
  const expoProjectId = process.env.BB_MOBILE_EXPO_PROJECT_ID;
  if (
    expoProjectId &&
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(expoProjectId)
  ) {
    throw new Error("BB_MOBILE_EXPO_PROJECT_ID must be an Expo project UUID");
  }
  const androidPackage = isDev
    ? "app.getbb.mobile.dev"
    : config.android.package;
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    ? resolve(process.env.GOOGLE_SERVICES_JSON)
    : resolve(
        __dirname,
        isDev ? "google-services.dev.json" : "google-services.json",
      );
  const hasGoogleServicesFile = existsSync(googleServicesFile);
  if (process.env.GOOGLE_SERVICES_JSON && !hasGoogleServicesFile) {
    throw new Error(
      "GOOGLE_SERVICES_JSON must point to an existing Firebase configuration file",
    );
  }
  if (hasGoogleServicesFile) {
    let services;
    try {
      services = JSON.parse(readFileSync(googleServicesFile, "utf8"));
    } catch {
      throw new Error(
        "Firebase configuration must be a valid google-services JSON file",
      );
    }
    if (
      !Array.isArray(services?.client) ||
      !services.client.some(
        (client) =>
          client?.client_info?.android_client_info?.package_name ===
          androidPackage,
      )
    ) {
      throw new Error(
        `Firebase configuration must include an Android client for ${androidPackage}`,
      );
    }
  }
  return {
    ...config,
    extra: {
      ...config.extra,
      bbMobileVariant: variant,
      ...(expoProjectId
        ? { eas: { ...config.extra?.eas, projectId: expoProjectId } }
        : {}),
    },
    ...(isDev
      ? {
          name: "bb dev",
          icon: "./assets/icon-dev.png",
          web: { ...config.web, favicon: "./assets/favicon-dev.png" },
          plugins: config.plugins.map((plugin) =>
            Array.isArray(plugin) && plugin[0] === "expo-splash-screen"
              ? [
                  plugin[0],
                  {
                    ...plugin[1],
                    image: "./assets/splash-logo-dev.png",
                    dark: {
                      ...plugin[1].dark,
                      image: "./assets/splash-logo-dev.png",
                    },
                  },
                ]
              : plugin,
          ),
        }
      : {}),
    android: {
      ...config.android,
      ...(isDev
        ? {
            package: "app.getbb.mobile.dev",
            intentFilters: [],
            adaptiveIcon: {
              ...config.android.adaptiveIcon,
              backgroundColor: "#000000",
              backgroundImage: undefined,
              foregroundImage: "./assets/android-icon-foreground-dev.png",
            },
          }
        : {}),
      googleServicesFile: hasGoogleServicesFile
        ? googleServicesFile
        : undefined,
    },
  };
};
