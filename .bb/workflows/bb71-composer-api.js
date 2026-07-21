export const meta = {
  name: "bb71-composer-api",
  description:
    "Implement the BB-71 composer plugin API, migrate improve-prompt + omegacode, and gate with a GPT-5.6 review",
  phases: [
    { title: "Contract", detail: "SDK types, composer registry, hooks" },
    {
      title: "Hosts",
      detail: "Action slots + menu, banners, decoration engine",
    },
    { title: "Integrate", detail: "Wire editor options, typecheck, run tests" },
    {
      title: "Polish & migrate",
      detail: "Deprecation/docs/example + plugin migrations",
    },
    { title: "Review", detail: "GPT-5.6 gate with bounded fix loop" },
  ],
};

const WS = "/home/sawyer/.bb/worktrees/env_exbmqbwd7x/bb";
const PLUGINS = "/home/sawyer/bb-plugins-migration";

const COMMON = `You are one worker in a coordinated build of BB-71 (composer plugin API redesign) inside the bb repo at ${WS} (branch bb/redesign-composer-plugin-api-thr_54rtepgpbh).
FIRST read the authoritative approved spec: ${WS}/composer-api-plan.html (read the HTML source; sections are numbered). Repo rules in ${WS}/AGENTS.md apply (notably: use turbo for typecheck/build; no DB mocking; pipe slow test output to a file under /tmp then read it).
Do NOT git commit or push. Do NOT run pnpm install unless a command fails without it. Stay strictly inside your owned files listed below — other workers own the rest concurrently.
Canonical names you must use exactly (spec section 5): ComposerCustomization, ComposerPlusMenuItem, ComposerView, ComposerRichTextSpec, ComposerStructuredDraft, app.composer.customize(...), snapshot field composerCustomizations, hook useComposerView(), PluginComposerApi.setInputLock(locked), and setTextEffect({ className } | null).
End your final message with: OUTCOME (done/partial/blocked), FILES CHANGED, CHECKS RUN (with real results), and EXPORTED API SURFACE you created. Report failures honestly; never claim green checks you did not run.`;

phase("Contract");
const contract = await agent(
  `${COMMON}
Objective — spec phase P1, the contract layer everything else builds on:
1. ${WS}/packages/plugin-sdk/src/app-contract.ts: add the composer types from spec section 5 verbatim in intent (ComposerCustomization with scopes?/actions?/banners?/plusMenu?/richText?, ComposerPlusMenuItem, ComposerView, ComposerRichTextSpec, ComposerStructuredDraft). Add a "composer" namespace to PluginAppBuilder with customize(registration). Make PluginComposerApi.setTextEffect accept { className: string } | null and add setInputLock(locked: boolean). Add useComposerView(): ComposerView to PluginSdkApp. Update bundled declaration/export surfaces the same way (find how existing types are exported/bundled and follow that pattern).
2. ${WS}/apps/app/src/lib/plugin-slots.ts: add composerCustomizations to PluginRegistrationSet and PluginSlotSnapshot with the same wholesale-replace + generation semantics as existing kinds.
3. Locate the app-side collector that implements app.slots.* against PluginRegistrationSet (search for where composerAccessory registrations are collected/interpreted) and implement app.composer.customize there with per-entry validation per spec section 7: id shape (letters/digits/-/_), duplicate ids within a plugin rejected individually with a logged reason, invalid scope kinds rejected, siblings survive.
4. ${WS}/apps/app/src/lib/plugin-sdk-hooks.ts (+ plugin-composer-host if needed): implement runtime setInputLock and widened setTextEffect with the SAME auto-clear scoping the existing setTextEffect has (clears on unmount, scope change, plugin reload). Create and export a ComposerView React context + provider (name it PluginComposerViewProvider) and implement useComposerView() reading it, with a sensible route-derived fallback when no provider is mounted (mirror how useComposer falls back). The lock state must be observable by the host (export a store/context the prompt box can subscribe to) — the actual editor read-only wiring is another worker's job.
5. @bb/plugin-sdk testing harness (packages/plugin-sdk, testing/app entry): capture composer.customize registrations like slots are captured.
6. Focused tests: registry validation (duplicate ids, invalid scopes, wholesale replace on reload), following existing test idioms near plugin-slots.
Validation: pnpm exec turbo run typecheck --filter=@bb/plugin-sdk --filter=@bb/app, plus your new tests. The app must still typecheck with nothing consuming the new registrations yet.`,
  {
    label: "P1 contract+registry",
    phase: "Contract",
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningLevel: "high",
  },
);

phase("Hosts");
const hosts = await parallel([
  () =>
    agent(
      `${COMMON}
Contract-worker report (already landed in the working tree):
${contract}
Objective — spec phase P2, prompt box integration. OWNED FILES: ${WS}/apps/app/src/components/promptbox/PromptBoxInternal.tsx, PromptBoxActionsMenu.tsx, their test files, and ${WS}/apps/app/src/components/plugin/ (PluginComposerAccessories.tsx, plugin-composer-host.tsx, new files for action slots). Do NOT touch the editor/ directory, FollowUpPromptBox.tsx, or NewThreadPromptBox.tsx.
1. Action slots (spec 6.1): render each plugin action component from the composerCustomizations snapshot (scope-filtered) in the right control group BEFORE the mic, each inside PluginSlotMount keyed by pluginId/customizationId/actionId/generation, wrapped in a height-constrained container matching the action row. Not mounted in compact layout. Order: pluginId asc, then registration order, then array order.
2. Mount PluginComposerViewProvider so useComposer()/useComposerView() inside slots bind to THIS composer instance (extend the existing PluginComposerHost publishing); populate layout ("expanded"|"compact"|"zen"), draft {text,isEmpty,attachmentCount}, run {isRunning,isSubmitting}, scope.
3. Input lock (spec 6.4/7): subscribe to the lock store from the contract layer; while locked set the Tiptap editor non-editable and aria-busy on the editor container, keep submit/stop and plugin buttons interactive.
4. Plus menu (spec 6.2): render plugin ComposerPlusMenuItem entries in PromptBoxActionsMenu after native items behind a separator; group header with plugin display name when 2+ plugins contribute; disabled supports boolean or (view)=>boolean; run(ctx) receives the bound composer API + view; reuse the native selectedItemRef close/focus path; contain run errors (toast + console).
5. Suppress action slots, plugin menu items while a pendingInteraction replaces the composer.
6. Focused tests in the owned test files: slot mount/order, crash isolation (throwing component collapses only itself), lock makes editor read-only and releases, plugin menu section + focus behavior, compact suppression, native voice/submit untouched.
Validation: pnpm exec turbo run typecheck --filter=@bb/app and run the owned test files (pipe output to /tmp, read it).`,
      {
        label: "P2 promptbox UI",
        phase: "Hosts",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ),
  () =>
    agent(
      `${COMMON}
Contract-worker report (already landed in the working tree):
${contract}
Objective — spec phase P3, banner slots. OWNED FILES: a NEW ${WS}/apps/app/src/components/plugin/PluginComposerBanners.tsx (+ test), ${WS}/apps/app/src/components/promptbox/FollowUpPromptBox.tsx, NewThreadPromptBox.tsx, and the side-chat/queued composer hosts you locate (search for who passes the "stack" prop / renders FollowUpPromptBox and the side-chat composer). Do NOT touch PromptBoxInternal.tsx, PromptBoxActionsMenu.tsx, or the editor/ directory.
1. PluginComposerBanners (spec 6.3): render banner components from the composerCustomizations snapshot for the active scope, BELOW native cards and immediately above the composer, each in PluginSlotMount keyed with generation + a scope key so scope changes remount. chrome "card" (default) wraps in PromptStackCard with an aria-label of the plugin name; "bare" renders unwrapped inside the measured stack. A banner rendering null collapses its row.
2. Append it to the stack composition in every host that renders a stack (follow-up, new-thread, side chat; queued editor if it shows the stack), passing scope. The existing stack measurement must keep working — do not add your own observers.
3. Focused tests: card vs bare chrome, null collapse, crash isolation per card, scope-change remount, ordering across two fake plugins.
Validation: pnpm exec turbo run typecheck --filter=@bb/app and run the owned test files (pipe to /tmp).`,
      {
        label: "P3 banner slots",
        phase: "Hosts",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ),
  () =>
    agent(
      `${COMMON}
Contract-worker report (already landed in the working tree):
${contract}
Objective — spec phase P4, the unified decoration engine. OWNED FILES: ${WS}/apps/app/src/components/promptbox/editor/** only (plus a new lib module there if needed). Do NOT edit PromptBoxInternal.tsx — keep promptEditorExtensions() backward compatible by adding OPTIONAL options; the integrator wires the call site afterward.
1. Build one decoration-based extension that replaces both PromptUltracodeHighlightExtension and PromptTextEffectExtension. Sources, painted host-first then plugins in composition order, overlapping classes stacking:
   a. Content-derived rules: { id, match(text) => [{from,to}], className } evaluated against the serialized plain text (mentions count as their text representation — reuse prompt-editor-serialization's offset mapping), recomputed on doc changes. A throwing match() disables that rule until the next plugin generation, logged once.
   b. State-derived whole-draft effects: { className } driven by setTextEffect plumbing from the contract layer.
2. Re-register the ultracode highlight as a HOST source on this engine using the exact same public shape, then delete the old extension. Visual parity required.
3. onDraftChange (spec 5): debounced read-only observation delivering ComposerStructuredDraft (text + mention spans) per registered richText.onDraftChange.
4. Extend promptEditorExtensions options additively (e.g. optional getDecorationSources / observer hooks) with JSDoc for the integrator.
5. Focused tests: offsets correct around mentions, decorations in rich AND plain modes, serialization byte-identical with rules active, classes applied/removed across edits, throwing match disabled, ultracode parity.
Validation: pnpm exec turbo run typecheck --filter=@bb/app and run editor-related tests (pipe to /tmp).`,
      {
        label: "P4 decoration engine",
        phase: "Hosts",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "high",
      },
    ),
]);
const hostReports = hosts.filter(Boolean).join("\n\n=== NEXT WORKER ===\n\n");
log("Host workers finished; integrating");

phase("Integrate");
const integration = await agent(
  `${COMMON}
All host-layer workers have finished. Their reports:
${hostReports}
Objective — integrate and validate the whole feature in ${WS}:
1. Wire the new optional promptEditorExtensions options into PromptBoxInternal.tsx (rule sources from the composerCustomizations snapshot for the active scope, imperative effect source, onDraftChange observers) per the P4 worker's JSDoc.
2. pnpm exec turbo run typecheck --filter=@bb/app --filter=@bb/plugin-sdk — fix all errors.
3. Run the app test suite for promptbox + plugin areas and the plugin-sdk tests (pnpm exec turbo run test with the right --filter, output piped to /tmp/bb71-tests.txt, then read it). Fix real failures; do not delete or skip tests to get green. If a pre-existing failure is unrelated, prove it by checking git stash / main behavior and note it.
4. Sanity-check spec invariants: native submit/stop/voice/attach untouched, compact suppression, pendingInteraction suspension, lock auto-release.
Then git add -A and git commit in ${WS} with message "Add composer plugin customization API (BB-71)" and the trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>". Commit only this repo, not the plugins clone.`,
  {
    label: "integrate+validate",
    phase: "Integrate",
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningLevel: "high",
  },
);

phase("Polish & migrate");
const MIGRATE_COMMON = `The new API is implemented and committed in ${WS} (integration report below). The plugins repo clone to migrate is at ${PLUGINS} — work on its main branch, do NOT commit there either.
Integration report:
${integration}
To get types: build the SDK (cd ${WS} && pnpm exec turbo run build --filter=@bb/plugin-sdk) and refresh the plugin's vendored declaration files (types/bb-plugin-sdk-app.d.ts etc.) from the built output, following how the existing vendored d.ts was produced.
Definition of done: plugin typechecks and its vitest suite passes (run it inside the plugin directory; pipe output to /tmp and read it); update the plugin's tests to the new API using @bb/plugin-sdk/testing/app harness capture where applicable; README updated. If the plugin build pipeline cannot bundle a .css file, ship effect styles by rendering a <style> element from the plugin's own component and note this limitation in your report.`;

const polishAndMigrate = await parallel([
  () =>
    agent(
      `${COMMON}
Integration report:
${integration}
Objective — spec phase P5 polish inside ${WS} only:
1. Remove slots.composerAccessory from the SDK contract and document the pre-1.0 migration mapping.
2. Update plugin authoring docs: search docs/ and any plugin-sdk README/reference text for composerAccessory guidance and add the composer.customize surfaces per docs/cli-guide-and-skill.md conventions.
3. Add a small example/reference plugin exercising every region (action slot, plus menu item, banner, richText rule) in whatever location existing example/reference plugins live (search first; if none exists, add it under the plugin-sdk package's examples and reference it from docs).
4. Typecheck affected packages with turbo; run any doc/example tests.
Then git add -A and git commit in ${WS} with message "Document and exemplify composer customization API (BB-71)" and trailer "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>".`,
      {
        label: "P5 docs+example",
        phase: "Polish & migrate",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ),
  () =>
    agent(
      `${COMMON}
${MIGRATE_COMMON}
Objective — migrate improve-prompt at ${PLUGINS}/plugins/improve-prompt (spec section 8):
Replace the composerAccessory registration with app.composer.customize({ id, actions: [{ id: "improve", component: ImproveAction }] }). The action component follows spec section 4: useComposer() + useComposerView(), own busy state with AbortController, setTextEffect({ className }) for shimmer (plugin-owned CSS class), setInputLock(true/false) around the rewrite, setThreadRowStatus({ icon, label, tone? }), setText for the mention-safe replace, cancel = abort. Preserve every current behavior: draft transform, progress affordance, cancellation, undo path, focus, accessibility labels. Keep the server side untouched.`,
      {
        label: "migrate improve-prompt",
        phase: "Polish & migrate",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ),
  () =>
    agent(
      `${COMMON}
${MIGRATE_COMMON}
Objective — migrate omegacode at ${PLUGINS}/plugins/omegacode (spec section 8):
Replace the entire portal/DOM-walking banner mechanism (createPortal, closest(), querySelector, MutationObserver, the [data-omega-banner] anchor) with app.composer.customize({ id, banners: [{ id, component: WorkflowBanner }] }). The banner component renders the existing card content (or null when no workflow is active) and must contain zero host DOM traversal, portals, observers, or BB class-name references — grep the plugin afterward to prove those are gone and include the grep result in your report. Preserve the card's visual content and behaviors; host card chrome now comes from chrome: "card".`,
      {
        label: "migrate omegacode",
        phase: "Polish & migrate",
        provider: "codex",
        model: "gpt-5.6-sol",
        reasoningLevel: "medium",
      },
    ),
]);
const migrateReports = polishAndMigrate
  .filter(Boolean)
  .join("\n\n=== NEXT WORKER ===\n\n");
log("Polish + migrations finished; entering review gate");

phase("Review");
const REVIEW_SCHEMA = {
  type: "object",
  required: ["verdict", "findings"],
  additionalProperties: false,
  properties: {
    verdict: { enum: ["APPROVE", "REQUEST_CHANGES"] },
    findings: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "file", "summary"],
        additionalProperties: true,
        properties: {
          severity: { enum: ["critical", "high", "medium", "low"] },
          file: { type: "string" },
          summary: { type: "string" },
          fix: { type: "string" },
        },
      },
    },
  },
};
const reviewPrompt = `You are the final review gate for BB-71. Do NOT edit any files and do NOT spawn subagents; read-only inspection and safe read-only commands only.
Review the integrated implementation in ${WS} (inspect the git log/diff for the new commits on this branch plus surrounding code) and the migrated plugins in ${PLUGINS} (git diff) against:
1. The approved spec ${WS}/composer-api-plan.html (authoritative), and
2. BB-71 acceptance criteria: all four regions usable via typed APIs across composer scopes; deterministic multi-plugin composition; per-contribution crash isolation with the native composer never degrading; cleanup on scope change/reload/pendingInteraction; omegacode migrated with zero DOM traversal/portals/observers/class-name deps; improve-prompt migrated with draft transforms, progress, cancellation, focus, a11y intact; serialization/mentions/undo/paste preserved with decorations active; focused tests for validation/order/collisions/crash isolation/regions/scope transitions; docs+declarations+example updated; composerAccessory removed pre-1.0 with a documented migration.
Also check AGENTS.md compliance (no HOST_DAEMON_PROTOCOL_VERSION bump should be needed — verify nothing crossed the server/daemon wire; typecheck/tests run via turbo).
Report findings in severity order with file:line references. Every REQUEST_CHANGES finding must be concrete and testable.`;

let verdict = null;
let rounds = 0;
const maxFixRounds = 2;
while (true) {
  verdict = await agent(reviewPrompt, {
    label: `gpt-5.6 review r${rounds + 1}`,
    phase: "Review",
    provider: "codex",
    model: "gpt-5.6-sol",
    reasoningLevel: "high",
    schema: REVIEW_SCHEMA,
  });
  if (!verdict || verdict.verdict === "APPROVE" || rounds >= maxFixRounds)
    break;
  rounds += 1;
  log(`Review requested changes (round ${rounds}); dispatching fixes`);
  await agent(
    `${COMMON}
The review gate returned REQUEST_CHANGES. Apply every blocking finding below in the appropriate repo (${WS} or ${PLUGINS}), rerun the relevant typechecks/tests via turbo (piped to /tmp), and amend nothing — add a new commit in ${WS} ("Address BB-71 review findings" + the Co-Authored-By trailer) if you changed that repo; leave ${PLUGINS} uncommitted.
Findings (JSON):
${JSON.stringify(verdict.findings)}`,
    {
      label: `fix round ${rounds}`,
      phase: "Review",
      provider: "codex",
      model: "gpt-5.6-sol",
      reasoningLevel: "high",
    },
  );
}

return {
  verdict: verdict ? verdict.verdict : "REVIEW_FAILED",
  reviewRounds: rounds + 1,
  outstandingFindings: verdict ? verdict.findings : [],
  migrateReports: migrateReports.slice(0, 4000),
};
