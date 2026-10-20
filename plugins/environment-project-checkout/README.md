# Project checkout

Runs threads in the project checkout on an enrolled machine. The plugin supplies the current, existing, and new branch control and refuses branch switches when the checkout is dirty or another live thread occupies it. Removal leaves the checkout intact.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider project-checkout`. Use `bb environment providers --json` for its inputs and availability.

Branch lookup prefers a local branch and falls back to `origin/<name>` when a fresh clone only has the remote reference. An existing remote branch becomes a local branch tracking origin; a new branch has no upstream. When creating a new branch, the provider records the resolved base ref (for example, `origin/dev` when `dev` is not local) as the environment's merge base, so the initial diff excludes changes already on that base. This applies even when a later thread reuses the checkout's environment. Switching to an existing branch clears the recorded merge base, so the diff falls back to the default branch. Attaching without a branch switch keeps whatever merge base the environment already has, and restoring a removed environment keeps the merge base it had before.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.
