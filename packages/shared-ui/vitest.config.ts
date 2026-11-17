import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

const compilerPreset = reactCompilerPreset();

export default defineWorkspaceTestConfig({
  plugins: [
    react(),
    babel({
      presets: [
        {
          ...compilerPreset,
          rolldown: {
            ...compilerPreset.rolldown,
            applyToEnvironmentHook: () => true,
          },
        },
      ],
    }),
  ],
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@bb/shared-ui",
      include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    }),
  },
});
