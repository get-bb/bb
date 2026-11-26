# Thread context card

A thread pane shows its thread context one of two ways: `banner`, the context
row above the composer, or `card`, the thread context card at the pane's
upper-right, below the header. bb picks one per pane: `card` for a thread
opened as a page whose pane is wide enough to fit the card beside the transcript, except on phones (a
narrow touch screen); `banner` everywhere else, including narrow panes and
threads shown inside a panel.

`app.slots.experimental_threadContextItem({ id, title, group, order?, banner?, card? })`
registers one piece of thread context and lets bb place it. `card` is
`{ row }`, a row in the card's top block, or `{ section }`, a section below
the rows with a divider above it: the card's counterparts of the Info tab's
`experimental_threadInfoRow` and `experimental_threadInfoSection`. `banner` is
`{ summary, action?, details?, useVisible? }`, a segment of the context row
above the composer (frontend-registration.md). Give the parts you draw: bb
shows the banner part in `banner` panes, and in `card` panes too when the item
has no card part, so a pane never shows the same thing twice. Items sort by
`group`, then `order` (unset last), then registration order, bb's first on a
tie, on each surface, using the Info tab's `experimental_THREAD_INFO_ROW_GROUPS`
(`experimental_THREAD_INFO_SECTION_GROUPS` for a card section). bb's parent
thread and Child threads, the Git plugin's changed files and GitHub PR
Status's pull request are items. The older
`app.slots.experimental_threadContextCardRow({ id, group, order?, component })`
and `app.slots.experimental_threadContextCardSection({ id, group, order?, component })`
keep working as card-only items. Card components receive `{ threadId, projectId, environment }`. A
row component renders `experimental_ThreadContextCardRow` rows; a section
component renders one `experimental_InfoSection` with its label (and an
optional count, accessory and trailing control) around those rows, as an Info
tab section does. Either returns null to show nothing for the thread; a crash
removes only that row or section.

bb owns the card, placement, and header button: each split pane has its own
card, and it stays put while messages scroll. In a wide pane the card sits
beside the transcript, and a medium pane moves the transcript aside to fit it;
there the header button pins or unpins it (`threadContextCard.pinned`,
default on). A pane too narrow for either shows the banner, and the header
button opens the card as a popover; the pane switches back as it widens.

In the card, `experimental_InfoSection` draws its label as a button that folds
the section. Sections start open, and bb remembers the ones the person folds
across threads and restarts (`threadContextCard.collapsedSections`, keyed
`<pluginId>/<sectionId>`, separate from the Info tab's). While folded, the
section's children unmount but its component stays mounted, so keep its
subscriptions cheap. Keep a long list short with `experimental_InfoList`, which
shows five rows and a "N more" toggle. A plugin built against an older SDK that
passes `title` keeps working: bb draws that title itself and logs a warning.

```tsx
app.slots.experimental_threadContextItem({
  id: "deploy",
  title: "Deploy",
  group: ROW_GROUPS.environment,
  order: 40,
  banner: { summary: DeploySummary, useVisible: useDeployVisible },
  card: { row: DeployRow },
});
function DeployRow({ threadId }: ExperimentalThreadContextCardProps) {
  const deploy = useDeploy(threadId);
  if (!deploy) return null;
  return <ThreadContextCardRow icon="Rocket" label={deploy.label} trailing={deploy.status} onClick={deploy.open} />;
}

app.slots.experimental_threadContextItem({ id: "deploys", title: "Deploys", group: SECTION_GROUPS.related, order: 40, card: { section: DeploysSection } });
function DeploysSection({ threadId }: ExperimentalThreadContextCardProps) {
  const deploys = useDeploys(threadId);
  if (deploys.length === 0) return null;
  return (
    <InfoSection label="Deploys" count={deploys.length}>
      <InfoList items={deploys} getKey={(deploy) => deploy.id} renderItem={(deploy) => (
        <li className="list-none"><ThreadContextCardRow icon="Rocket" label={deploy.label} onClick={deploy.open} /></li>
      )} />
    </InfoSection>
  );
}
```

A legacy `experimental_threadContextSegment` has no card part, so it keeps
showing in both kinds. Move it into an item with a card part rather than
checking `experimental_useThreadContextKind()` in its `useVisible`; in a
`card` pane bb then skips the banner part's `useVisible` entirely.

## Segment focus and related threads

bb owns keyboard focus for a segment's disclosure. Attach `toggleRef` to the
expand control and `collapseRef` to the collapse control in `details`; when
`onToggle` runs while focus is on one of them, bb focuses the other once the
row re-renders. Focus elsewhere (the composer, another segment) stays put, and
a segment that attaches neither ref keeps the browser's behavior. Don't write
your own handoff:

```tsx
function Summary({ isExpanded, onToggle, toggleRef }: ExperimentalThreadContextSegmentProps) {
  return <button ref={toggleRef} aria-expanded={isExpanded} onClick={onToggle}>Deploy</button>;
}
function Details({ isExpanded, onToggle, collapseRef }: ExperimentalThreadContextSegmentProps) {
  return isExpanded ? <button ref={collapseRef} onClick={onToggle}>Collapse deploy</button> : null;
}
```

For the segment's thread or a related one (its parent, a fork source), read
`experimental_useThread(id)`, not `experimental_useSidebarThreads()` plus
`find`. It returns `{ status, thread }`: `ready` with the thread, `loading`,
`notFound` (unknown or deleted), or `error`. A thread the sidebar holds is
ready at once and re-renders the component only when it changes; any other,
such as an archived parent, is fetched and kept current. `thread` has the
fields `useSdk().threads.get` returns except the five that only that request
computes (`canEditMessages` and the like). bb's parent-thread segment reads
the thread and its parent this way:

```tsx
const { thread } = experimental_useThread(threadId);
const { thread: parent } = experimental_useThread(thread?.parentThreadId ?? "");
```
