# Codex installation without Node.js

The Windows app smoke job runs `pnpm exec turbo run smoke:codex-install --filter=bb-app` after building the bundled app. It is a required, uncached check; a failing install fails the job.

The disposable runner uses a fresh home containing spaces and an apostrophe, a fresh bb data directory, and separate server and daemon endpoints. Node.js, npm and Codex are removed from its process and registry PATH. A copy of the runtime named `bb-runtime.exe` starts bb by absolute path, matching an application-owned runtime without making a `node` executable available to installers. The original registry PATH is restored during cleanup.

The check first proves that the previous `npm.cmd install -g @openai/codex@latest` command fails because npm cannot be found. It then calls the same provider installation endpoint as setup's Install button, runs OpenAI's real native installer, and requires bb's installation verification to succeed. The installed executable must report a version. With the native directory still absent from PATH, provider health must be `unauthenticated`, and the returned PowerShell login command must run. Pi must report the `nodejs` prerequisite and offer no broken install action.

The job publishes a result summary and JSON artifact with the tested revision. It does not authenticate an account or send an agent turn. The Linux browser QA covers the rendered setup interaction separately.

The native executable resolver honors OpenAI's `CODEX_INSTALL_DIR` as well as its default directory. The optional `missingPrerequisite` status field is carried by daemon protocol 257 so enrolled machines update before serving the new prerequisite state.
