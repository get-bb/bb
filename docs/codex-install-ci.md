# Agent installation without Node.js

The Windows app smoke job runs `pnpm exec turbo run smoke:codex-install --filter=bb-app` after building the bundled app. It is a required, uncached check; a failing install fails the job.

The disposable runner uses a fresh home containing spaces and an apostrophe, a fresh bb data directory, and separate server and daemon endpoints. Node.js, npm, Pi and Codex are removed from its process and registry PATH. A copy of the runtime named `bb-runtime.exe` starts bb by absolute path without making a `node` executable available to installers. The original registry PATH is restored during cleanup.

The check proves that the previous Codex npm install fails without npm, then runs the native installer through setup's endpoint. Codex must report a version and unauthenticated health, and its generated sign-in command must run before PATH refresh. A browser then clicks Pi's Install button in setup. Pi's real executable must report a version, provider health must be unauthenticated, and setup must show installed and not signed in. The Pi browser assertion also fails against the prerequisite-link implementation because that revision offers no Install button.

Pi uses bb's existing runtime and bundled npm to install into a private user directory, with lifecycle scripts disabled as supported by Pi's distribution. Desktop uses Electron in Node mode; headless bb uses its existing Node runtime. Both invoke the package's manifest-declared executable directly, without requiring Node or npm on PATH. Windows RPC launches avoid shell shims; the sign-in launcher handles quoted paths and Electron mode. Linux AppImage launchers use the stable AppImage path instead of its transient mount.

The job publishes a result summary and JSON artifact with the tested revision. It does not authenticate an account or send an agent turn. Linux browser QA separately covers both setup Install interactions and desktop/mobile screenshots.
