function parseRemoteEnv() {
  const value = process.env.REMOTE;
  if (value === undefined) return false;

  const normalizedValue = value.trim().toLowerCase();
  if (["true", "1", "yes", "y"].includes(normalizedValue)) return true;
  if (["false", "0", "no", "n", ""].includes(normalizedValue)) return false;

  throw new Error("REMOTE must be a boolean");
}

const remote = parseRemoteEnv();

/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: ["src/**/*.stories.tsx"],
  defaultStory: "",
  viteConfig: "./.ladle/vite.config.ts",
  ...(remote
    ? {
        host: "0.0.0.0",
        // Ladle defaults Vite HMR to localhost independently of `host`.
        // Empty string keeps Vite's websocket listener non-loopback and lets
        // the browser use the page hostname for the websocket URL.
        hmrHost: "",
      }
    : {}),
  addons: {
    theme: {
      defaultState: "dark",
    },
  },
};
