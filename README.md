# Opulent Desktop

Opulent-branded distribution of [bb](https://github.com/get-bb/bb), preserving its full Electron/React app, server, host daemon, plugin system, streaming and local agent interfaces. Comet redesign and a second Rust runtime are deferred.

M1 is a branding and workspace-integration milestone, **not** a completed self-training product. The experimental learning contracts are under [`packages/opulent-learning`](packages/opulent-learning/README.md). They are not wired into live agent execution, dataset admission or model training yet.

## Develop

Use Node 22.19 or newer in the Node 22 line and the pinned pnpm version in package.json.

```sh
corepack pnpm install --frozen-lockfile
pnpm dev
pnpm exec turbo run build --filter=@bb/app --filter=@bb/desktop --filter=bb-app
pnpm exec turbo run typecheck test --filter=@opulent/learning-contracts
```

See [debugging and QA](docs/debugging-and-qa.md) for the real desktop launch path. The [upstream README](docs/UPSTREAM-README.md) is preserved as historical documentation; its download links install **upstream bb**, not this fork. No signed Opulent release is promised by M1.

## Compatibility boundary

- Keep the `bb` CLI, `.bb` configuration, `BB_*` variables, plugin ids, SDK namespaces and wire protocols intact. Renaming these would break existing workflows and is not a visual branding change.
- Visible app identity, PWA names/icons and desktop package identity use Opulent. Desktop update URLs point only at `OpulentiaAI/bb`, not upstream release binaries. Local packaging does not automatically publish a release.
- Existing bb Connect remains an upstream service, labelled as such. This fork does not pretend it is already connected to Opulent Cloud.
- The future serving path captures real token ids, masks and logprobs. Subscription-backed agents can help author environments through supported account interfaces; authoring traces are not on-policy samples by default.

## License and provenance

bb is MIT, Copyright (c) 2026 Michael Yong; the root LICENSE is unchanged. Additional Comet and Repo2RLEnv notices are retained with the experimental learning contracts. Baseline: get-bb/bb commit `bf5bda1120ecb31f52fe1bd4186c113df5f9e30f`, a fast-forward descendant of the existing OpulentiaAI/bb main. M1 is developed on a separate branch; main is not rewritten.
