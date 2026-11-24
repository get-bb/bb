# Ultracite migration

BB-9 adopts Ultracite 7.12.4 for maintained JavaScript and TypeScript without a source reformat.

## Configuration

Keep using pnpm 9.15.0 and the existing commands:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run lint lint:type-aware typecheck
pnpm format:check
pnpm format
```

The pinned presets support the existing Oxlint 1.91.0 and Oxfmt 0.64.0.
No engine upgrades, hooks, or agent-file changes are required.
Setup is manual, following the [migration guide](https://www.ultracite.ai/docs/migrate).

Oxlint loads `oxlint.config.ts`. Its layers are Ultracite core and React, migration exceptions, then the existing policy.
`oxlint.policy.json` retains the previous `.oxlintrc.json` rules, severities, ordered package overrides, custom plugin, and ignores.
The plugin union enables the presets without replacing the policy's package-specific React rules.
Turbo hashes the wrapper, both policy files used by lint, package manifest, and lockfile.

Oxfmt loads `oxfmt.config.ts` and the unchanged formatter policy, now named `oxfmt.policy.json`.
The wrapper retains trailing commas in all positions and preserves prose wrapping.
It disables import and Tailwind sorting and retains disabled package-JSON sorting.
These differences from Ultracite preserve existing style and prevent a broad reformat.
The existing generated, template, native, and package ignores still apply.

The installed presets export JavaScript modules, not JSON configs.
Oxlint rejects JavaScript paths in JSON `extends`, and both engines reject a recognized JSON config beside a TypeScript config.
The policy renames avoid those errors while keeping schemas and ordered overrides intact.
Restart editor language servers after pulling the change.

## Retained checks and limits

Package lint commands still invoke Oxlint directly, preserving package selection and forked-plugin contracts.
The custom `scripts/oxlint-plugin.mjs` rules remain active.
The separate `.oxlintrc.type-aware.json` remains unchanged, including promise checks and root scripts.
Ultracite's ordinary lint preset does not replace these typed checks.

CI still runs Turbo lint, type-aware lint, and typecheck with its existing affected-package selection.
It does not currently run the formatter.
`pnpm format:check` still checks non-JS files supported by Oxfmt, including JSON, Markdown, YAML, and CSS.
Neither preset replaces native builds, framework checks, custom architectural tests, or ordinary package tests.

The presets enable 581 distinct top-level rules before project policy.
Progressive migration defers 219 rules with observed diagnostics, leaving 362 preset rules enabled before package overrides.
Existing rules and severities take precedence and are not deferred.
No whole preset or category was disabled as part of this migration.
Every deferred rule also failed on a non-generated file.
The table below records that non-generated diagnostic census through the existing package lint commands.
Generated paths were excluded from the census, not newly ignored by lint.
The original Codex lint command also checks its generated schema; that coverage is unchanged.

To migrate a rule, remove its entry from `oxlint.migration.json`, fix its diagnostics, and run the same checks.
Do not remove existing project-policy rules to silence a preset diagnostic.

## Verification at the migration baseline

Baseline commit is `48f57bc89633f1f7cb2c679922195cc2f25e4b0b`.

- Frozen baseline install passed. After the dependency update, a forced reinstall was interrupted; the subsequent frozen install completed successfully.
- Turbo lint and type-aware lint passed before and after, with 299 successful tasks.
- Formatter checks reported the same 282 files before and after. No source was reformatted.
- Scoped scripts typecheck passed.
- Focused custom-rule and plugin-fork tests passed, 60 tests in three files.
- Full scripts tests had the same two CI-install fixture failures before and after, with 343 tests passing. The fixture child rejected `--fetch-retries`; direct pnpm 9.15.0 accepts that flag. Explicit Node 24 and pnpm 9 PATH did not remove the fixture failures. The child's CLI selection remains unconfirmed.
- Existing React compiler warnings remain warnings. The migration does not repair unrelated baseline failures.

Full command logs and the rule census are retained with the BB-9 implementation report in thread storage.

## Deferred rules

Counts are observed non-generated diagnostics, not unique files.

| Rule                                                     | Diagnostics |
| -------------------------------------------------------- | ----------: |
| `accessor-pairs`                                         |           1 |
| `array-callback-return`                                  |           6 |
| `arrow-body-style`                                       |          54 |
| `class-methods-use-this`                                 |         174 |
| `complexity`                                             |         306 |
| `curly`                                                  |        8630 |
| `default-case`                                           |         215 |
| `eqeqeq`                                                 |         129 |
| `func-name-matching`                                     |           9 |
| `func-names`                                             |          56 |
| `func-style`                                             |       15729 |
| `logical-assignment-operators`                           |           3 |
| `max-classes-per-file`                                   |          32 |
| `no-alert`                                               |           1 |
| `no-await-in-loop`                                       |         808 |
| `no-bitwise`                                             |         102 |
| `no-case-declarations`                                   |           4 |
| `no-constructor-return`                                  |           1 |
| `no-control-regex`                                       |           7 |
| `no-duplicate-imports`                                   |          66 |
| `no-empty`                                               |          80 |
| `no-empty-function`                                      |         342 |
| `no-eq-null`                                             |         129 |
| `no-implicit-globals`                                    |           5 |
| `no-inline-comments`                                     |           9 |
| `no-inner-declarations`                                  |           5 |
| `no-loop-func`                                           |          16 |
| `no-multi-assign`                                        |           4 |
| `no-multi-str`                                           |           2 |
| `no-negated-condition`                                   |         682 |
| `no-nested-ternary`                                      |         874 |
| `no-new-func`                                            |           6 |
| `no-param-reassign`                                      |          16 |
| `no-plusplus`                                            |         176 |
| `no-promise-executor-return`                             |         318 |
| `no-redeclare`                                           |           2 |
| `no-regex-spaces`                                        |           2 |
| `no-script-url`                                          |          11 |
| `no-shadow`                                              |         204 |
| `no-template-curly-in-string`                            |          11 |
| `no-unmodified-loop-condition`                           |           4 |
| `no-unreachable-loop`                                    |           1 |
| `no-unsafe-optional-chaining`                            |           4 |
| `no-unused-vars`                                         |          55 |
| `no-use-before-define`                                   |        1602 |
| `no-useless-concat`                                      |           3 |
| `no-useless-escape`                                      |           5 |
| `no-useless-return`                                      |          41 |
| `no-void`                                                |         229 |
| `object-shorthand`                                       |          16 |
| `one-var`                                                |           2 |
| `prefer-arrow-callback`                                  |          64 |
| `prefer-const`                                           |           6 |
| `prefer-destructuring`                                   |         800 |
| `prefer-named-capture-group`                             |         388 |
| `prefer-template`                                        |          63 |
| `preserve-caught-error`                                  |          15 |
| `require-await`                                          |        1957 |
| `require-unicode-regexp`                                 |        1363 |
| `require-yield`                                          |           3 |
| `sort-keys`                                              |       33597 |
| `symbol-description`                                     |           1 |
| `import/consistent-type-specifier-style`                 |        3669 |
| `import/default`                                         |           4 |
| `import/first`                                           |          69 |
| `import/newline-after-import`                            |          23 |
| `import/no-cycle`                                        |           4 |
| `import/no-duplicates`                                   |          77 |
| `import/no-empty-named-blocks`                           |           8 |
| `import/no-named-as-default`                             |          46 |
| `import/no-named-as-default-member`                      |           1 |
| `jsdoc/check-tag-names`                                  |           5 |
| `jsdoc/empty-tags`                                       |           4 |
| `jsx-a11y/anchor-has-content`                            |           4 |
| `jsx-a11y/anchor-is-valid`                               |           1 |
| `jsx-a11y/aria-role`                                     |          67 |
| `jsx-a11y/click-events-have-key-events`                  |          32 |
| `jsx-a11y/control-has-associated-label`                  |          13 |
| `jsx-a11y/heading-has-content`                           |           2 |
| `jsx-a11y/interactive-supports-focus`                    |           3 |
| `jsx-a11y/label-has-associated-control`                  |          18 |
| `jsx-a11y/media-has-caption`                             |           3 |
| `jsx-a11y/no-noninteractive-element-interactions`        |          17 |
| `jsx-a11y/no-noninteractive-element-to-interactive-role` |           1 |
| `jsx-a11y/no-noninteractive-tabindex`                    |          12 |
| `jsx-a11y/no-redundant-roles`                            |           3 |
| `jsx-a11y/no-static-element-interactions`                |          39 |
| `jsx-a11y/prefer-tag-over-role`                          |         227 |
| `jsx-a11y/role-has-required-aria-props`                  |           1 |
| `jsx-a11y/role-supports-aria-props`                      |           2 |
| `node/callback-return`                                   |          52 |
| `node/global-require`                                    |           1 |
| `oxc/branches-sharing-code`                              |           6 |
| `oxc/no-accumulating-spread`                             |           3 |
| `oxc/no-barrel-file`                                     |           8 |
| `oxc/no-this-in-exported-function`                       |           2 |
| `promise/avoid-new`                                      |         823 |
| `promise/no-callback-in-promise`                         |           5 |
| `promise/no-nesting`                                     |           3 |
| `promise/no-promise-in-callback`                         |           2 |
| `promise/no-return-wrap`                                 |           2 |
| `promise/param-names`                                    |         105 |
| `promise/prefer-await-to-callbacks`                      |         382 |
| `promise/prefer-await-to-then`                           |         705 |
| `promise/prefer-catch`                                   |          27 |
| `react/button-has-type`                                  |          84 |
| `react/display-name`                                     |           2 |
| `react/exhaustive-effect-dependencies`                   |          93 |
| `react/function-component-definition`                    |        3046 |
| `react/hook-use-state`                                   |         139 |
| `react/hooks`                                            |           7 |
| `react/iframe-missing-sandbox`                           |           1 |
| `react/jsx-curly-brace-presence`                         |          33 |
| `react/jsx-handler-names`                                |         241 |
| `react/jsx-key`                                          |           6 |
| `react/jsx-no-constructed-context-values`                |          56 |
| `react/jsx-no-useless-fragment`                          |          40 |
| `react/no-children-prop`                                 |           1 |
| `react/no-clone-element`                                 |           3 |
| `react/no-danger`                                        |           5 |
| `react/no-deriving-state-in-effects`                     |           1 |
| `react/no-object-type-as-default-prop`                   |          43 |
| `react/no-react-children`                                |           5 |
| `react/no-unescaped-entities`                            |          23 |
| `react/no-unstable-nested-components`                    |           9 |
| `react/rule-suppression`                                 |          13 |
| `react/self-closing-comp`                                |           3 |
| `react/state-in-constructor`                             |           7 |
| `react/style-prop-object`                                |           1 |
| `react/todo`                                             |          42 |
| `typescript/array-type`                                  |         302 |
| `typescript/consistent-generic-constructors`             |           4 |
| `typescript/consistent-indexed-object-style`             |          13 |
| `typescript/consistent-type-definitions`                 |         122 |
| `typescript/consistent-type-imports`                     |         175 |
| `typescript/method-signature-style`                      |         866 |
| `typescript/no-dynamic-delete`                           |          21 |
| `typescript/no-empty-interface`                          |           1 |
| `typescript/no-empty-object-type`                        |           1 |
| `typescript/no-explicit-any`                             |           4 |
| `typescript/no-extraneous-class`                         |           6 |
| `typescript/no-import-type-side-effects`                 |          33 |
| `typescript/no-inferrable-types`                         |           4 |
| `typescript/no-invalid-void-type`                        |          45 |
| `typescript/no-namespace`                                |           3 |
| `typescript/no-non-null-assertion`                       |        1469 |
| `typescript/no-this-alias`                               |           4 |
| `typescript/parameter-properties`                        |          80 |
| `typescript/prefer-as-const`                             |           1 |
| `typescript/prefer-for-of`                               |           6 |
| `typescript/triple-slash-reference`                      |           1 |
| `unicorn/catch-error-name`                               |          44 |
| `unicorn/consistent-existence-index-check`               |          41 |
| `unicorn/consistent-function-scoping`                    |         861 |
| `unicorn/custom-error-definition`                        |          22 |
| `unicorn/escape-case`                                    |          71 |
| `unicorn/explicit-timer-delay`                           |           2 |
| `unicorn/filename-case`                                  |        1228 |
| `unicorn/import-style`                                   |         214 |
| `unicorn/new-for-builtins`                               |           2 |
| `unicorn/no-anonymous-default-export`                    |           1 |
| `unicorn/no-array-for-each`                              |         115 |
| `unicorn/no-array-method-this-argument`                  |           5 |
| `unicorn/no-array-reduce`                                |          19 |
| `unicorn/no-array-reverse`                               |          33 |
| `unicorn/no-array-sort`                                  |         356 |
| `unicorn/no-await-expression-member`                     |         603 |
| `unicorn/no-hex-escape`                                  |          35 |
| `unicorn/no-immediate-mutation`                          |          15 |
| `unicorn/no-lonely-if`                                   |           5 |
| `unicorn/no-negated-condition`                           |         682 |
| `unicorn/no-new-array`                                   |           7 |
| `unicorn/no-object-as-default-parameter`                 |          16 |
| `unicorn/no-thenable`                                    |           1 |
| `unicorn/no-this-assignment`                             |           4 |
| `unicorn/no-typeof-undefined`                            |           3 |
| `unicorn/no-unnecessary-array-splice-count`              |           5 |
| `unicorn/no-unreadable-array-destructuring`              |           1 |
| `unicorn/no-useless-collection-argument`                 |           4 |
| `unicorn/no-useless-fallback-in-spread`                  |          10 |
| `unicorn/no-useless-promise-resolve-reject`              |           2 |
| `unicorn/no-useless-spread`                              |          65 |
| `unicorn/no-useless-undefined`                           |         723 |
| `unicorn/numeric-separators-style`                       |        1875 |
| `unicorn/prefer-add-event-listener`                      |          38 |
| `unicorn/prefer-array-find`                              |          20 |
| `unicorn/prefer-array-flat-map`                          |           1 |
| `unicorn/prefer-array-index-of`                          |           9 |
| `unicorn/prefer-at`                                      |          34 |
| `unicorn/prefer-code-point`                              |          25 |
| `unicorn/prefer-default-parameters`                      |           1 |
| `unicorn/prefer-dom-node-append`                         |          54 |
| `unicorn/prefer-dom-node-dataset`                        |         520 |
| `unicorn/prefer-dom-node-remove`                         |           2 |
| `unicorn/prefer-dom-node-text-content`                   |           2 |
| `unicorn/prefer-event-target`                            |           7 |
| `unicorn/prefer-export-from`                             |          43 |
| `unicorn/prefer-import-meta-properties`                  |          33 |
| `unicorn/prefer-logical-operator-over-ternary`           |           7 |
| `unicorn/prefer-modern-dom-apis`                         |           5 |
| `unicorn/prefer-module`                                  |          26 |
| `unicorn/prefer-native-coercion-functions`               |           7 |
| `unicorn/prefer-number-coercion`                         |          72 |
| `unicorn/prefer-number-properties`                       |          20 |
| `unicorn/prefer-query-selector`                          |          47 |
| `unicorn/prefer-response-static-json`                    |          75 |
| `unicorn/prefer-set-has`                                 |           6 |
| `unicorn/prefer-single-call`                             |          24 |
| `unicorn/prefer-spread`                                  |         132 |
| `unicorn/prefer-string-replace-all`                      |         188 |
| `unicorn/prefer-string-starts-ends-with`                 |           3 |
| `unicorn/prefer-structured-clone`                        |           4 |
| `unicorn/prefer-ternary`                                 |          25 |
| `unicorn/prefer-type-error`                              |         103 |
| `unicorn/relative-url-style`                             |          32 |
| `unicorn/require-module-specifiers`                      |           9 |
| `unicorn/require-post-message-target-origin`             |           4 |
| `unicorn/switch-case-braces`                             |        1532 |
| `unicorn/text-encoding-identifier-case`                  |         607 |
