const { existsSync } = require("node:fs");
const { resolve } = require("node:path");

module.exports = ({ config }) => {
  const variant = process.env.BB_MOBILE_VARIANT ?? "production";
  if (variant !== "production" && variant !== "dev") {
    throw new Error("BB_MOBILE_VARIANT must be production or dev");
  }
  const isDev = variant === "dev";
  const plugins = [
    ...(config.plugins ?? []),
    "./plugins/with-bb-share-extension",
    [
      "expo-share-intent",
      {
        disableAndroid: true,
        iosAppGroupIdentifier: "group.app.getbb.mobile.shared",
        iosActivationRules: {
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: 20,
          NSExtensionActivationSupportsMovieWithMaxCount: 20,
          NSExtensionActivationSupportsFileWithMaxCount: 20,
        },
      },
    ],
  ];
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON
    ? resolve(process.env.GOOGLE_SERVICES_JSON)
    : resolve(__dirname, "google-services.json");
  if (
    !isDev &&
    process.env.GOOGLE_SERVICES_JSON &&
    !existsSync(googleServicesFile)
  ) {
    throw new Error(
      "GOOGLE_SERVICES_JSON must point to an existing Firebase configuration file",
    );
  }
  return {
    ...config,
    plugins,
    extra: { ...config.extra, bbMobileVariant: variant },
    ...(isDev
      ? {
          name: "bb dev",
          icon: "./assets/icon-dev.png",
          web: { ...config.web, favicon: "./assets/favicon-dev.png" },
          plugins: plugins.map((plugin) =>
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
            googleServicesFile: undefined,
            intentFilters: [],
            adaptiveIcon: {
              ...config.android.adaptiveIcon,
              foregroundImage: "./assets/android-icon-foreground-dev.png",
            },
          }
        : existsSync(googleServicesFile)
          ? { googleServicesFile }
          : {}),
    },
  };
};
