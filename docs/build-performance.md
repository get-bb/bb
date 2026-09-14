# React Compiler transform caching

The app production build retains `@rolldown/plugin-babel` with the unchanged
`reactCompilerPreset()`. Its original filter, environment hook, parser options,
compiler optimizations, diagnostics, generated code, and source maps remain
authoritative. A wrapper stores only successful, validated `{ code, map }`
transform results with npm's `cacache`, which provides content integrity checks
and concurrent atomic storage. Missing, malformed, or corrupt entries run the
original transform and are replaced. Results with unknown fields or absolute
worktree paths, including JSON-escaped paths, are not stored.

The intermediate cache lives at
`<git-common-dir>/bb-cache/react-compiler`, allowing isolated worktrees for one
repository to reuse transforms without sharing dependency links or build
outputs. A non-Git checkout falls back to Vite's cache directory. Turbo still
owns the complete `dist/**` and `bundle-stats.json` outputs; a forced task runs
Vite, React compilation or transform restoration, minification, icon
generation, gzip, and Brotli compression. A whole-task cache hit or output
restoration does not start Vite and is distinct from a warm transform-cache
build.

The cache schema is versioned in `vite-react-compiler.ts`. Each transform key
covers the code received by Babel, repository-relative module identity and
query, module type, and Vite environment. The shared namespace covers the root
manifest, pnpm lockfile and workspace definition, wrapper and Vite config
dependency contents, actual Node version, platform, architecture, Node options
and execution flags, Vite mode and production status, and Babel/Node
environment. Dependency and plugin versions are represented by the lockfile.
This actual runtime identity is used even when a direct Turbo invocation omits
`BB_BUILD_TOOLCHAIN`.

Development serves continue through the original uncached transform.
`BABEL_SHOW_CONFIG_FOR` and `ENABLE_REACT_COMPILER_TIMINGS=1` also bypass the
disk cache so diagnostic behavior is preserved. Turbo hashes Node options,
Babel settings, compiler timing mode, Vite settings, dotenv files, and the
existing root `BB_BUILD_TOOLCHAIN` input.

## Verification method

Performance comparisons must use matched source and the same host. Run normal
package verification through Turbo. Use `--force` to bypass whole-task reuse
when measuring the intermediate cache, and record the reported transform hit
and miss counts. Keep cold-cache overhead, forced warm runs, a one-source edit,
an independent-worktree reuse run, whole-task hits, and missing-output
restoration as separate cases. Compare complete output manifests and hashes to
an uncached build so minification and both compression formats remain covered.
