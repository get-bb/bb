/** @type {import("@ladle/react").UserConfig} */
export default {
  stories: ["src/**/*.stories.tsx"],
  defaultStory: "",
  viteConfig: "./.ladle/vite.config.ts",
  host: "0.0.0.0",
  // Ladle defaults Vite HMR to localhost independently of `host`.
  // Empty string keeps Vite's websocket listener non-loopback and lets
  // the browser use the page hostname for the websocket URL.
  hmrHost: "",
  addons: {
    theme: {
      defaultState: "dark",
    },
  },
};
