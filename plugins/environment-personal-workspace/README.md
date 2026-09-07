# Personal workspace

Creates a per-thread directory for projectless work on an enrolled machine. Projectless sub-threads share their parent environment. Core retires the owned directory after the last thread is archived.

Bundled and installed automatically. Select it through the environment picker or `bb thread spawn --environment-provider personal-workspace`. Use `bb environment providers --json` for its inputs and availability.

The Plugin Guide documents the experimental environment-provider contract. Core owns durable launches, retries, cancellation, retirement, and teardown; this plugin owns resource creation and removal.
