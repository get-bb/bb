---
name: tips-authoring
description: "Add or update a tip in bb's built-in Tips plugin end to end: copy, action, illustration from the diagram kit, eligibility, tests, stories, and PR."
---

# Author a Tips plugin tip

`plugins/tips/AUTHORING.md` is the canonical rulebook: fields, voice, action
types, illustration rules, and the checklist. Read it first; this skill only
orders the work.

1. **Pick the source.** Start from a changelog entry, a guide or blog page, or a
   feature people miss. Set `source`, `addedAt` (the release it ships in), and
   `reviewedAt`. Add `expiresAt` only for tips about a release or a limited-time
   change.
2. **Write the copy** in `plugins/tips/catalog.ts` to AUTHORING.md's voice
   and length rules: describe the outcome, not the mechanism. Add the id to `TIP_IDS` in `plugins/tips/contract.ts` and to
   `TIP_TELEMETRY_IDS` in `packages/server-contract/src/api/system.ts`; tests
   fail when the three lists differ.
3. **Choose one action type.** Use `open-plugin` only for plugins in
   `apps/server/src/services/plugins/builtin-registry.ts`, and `open-page` only
   for the plugin store or core Settings routes. For multi-step setup, use a walkthrough prompt
   from `walkthroughPrompt(goal)`; AUTHORING.md's Walkthrough prompts section
   has the wording and rules.
4. **Draw the illustration** in `plugins/tips/illustrations.tsx` from
   `diagram-kit.tsx` parts, with one accent and one named hover animation. Add a
   kit part, plus a Diagram kit story cell, only when a second drawing needs it.
5. **Set `tier`, `eligible`, `retireWhen`, and any `boost`.** Use
   `"unranked"` unless the owner placed the tip in a tier; AUTHORING.md's
   Tiers section explains the order. Never record metrics in the repo. Add `engine.test.ts`
   cases when the logic is new.
6. **Check it in Ladle.** Open the `plugins/Tips` Illustrations and Diagram kit
   stories, and hover the new drawing in light and dark.
7. **Open or update the PR** with before and after screenshots of the New
   thread feed from the branch dev app. Let CI run the tests.
