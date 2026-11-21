# Thread context card

A thread pane shows its thread context one of two ways: `banner`, the context
row above the composer, or `card`, the thread context card at the pane's
upper-right, below the header. bb picks one per pane: `card` while the
`threadContextCard` experiment (off by default) is on, for a thread opened as a page whose pane
is wide enough to fit the card beside the transcript, except on phones (a
narrow touch screen); `banner` everywhere else, including narrow panes and
threads shown inside a panel.

`app.slots.experimental_threadContextCardRow({ id, group, order?, component })`
adds a row to the card's top block, and
`app.slots.experimental_threadContextCardSection({ id, group, order?, component })`
adds a section below the rows, with a divider above it: the card's
counterparts of the Info tab's `experimental_threadInfoRow` and
`experimental_threadInfoSection`, with the same registration shapes. Rows sort by `group`, then `order` (unset
last), then registration order, bb's first on a tie, using the Info tab's
`experimental_THREAD_INFO_ROW_GROUPS`; sections sort the same way using
`experimental_THREAD_INFO_SECTION_GROUPS`. bb's parent row and Child threads
section, the Git plugin's changes row, and GitHub PR Status's pull request row
use these slots. Components receive `{ threadId, projectId, environment }`. A
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
app.slots.experimental_threadContextCardRow({ id: "deploy", group: ROW_GROUPS.environment, order: 40, component: DeployRow });
function DeployRow({ threadId }: ExperimentalThreadContextCardProps) {
  const deploy = useDeploy(threadId);
  if (!deploy) return null;
  return <ThreadContextCardRow icon="Rocket" label={deploy.label} trailing={deploy.status} onClick={deploy.open} />;
}

app.slots.experimental_threadContextCardSection({ id: "deploys", group: SECTION_GROUPS.related, order: 40, component: DeploysSection });
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

Context segments keep showing in both kinds. A plugin whose segment shows the
same content as its card row hides the segment while the pane shows the card,
with `experimental_useThreadContextKind()`:

```tsx
app.slots.experimental_threadContextSegment({
  id: "deploy",
  title: "Deploy",
  group: "2_deploy",
  summary: DeploySummary,
  useVisible: () => experimental_useThreadContextKind() === "banner",
});
```

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
`experimental_useSidebarThread(id)`, not `experimental_useSidebarThreads()`
plus `find`: it returns the same object and re-renders only for that thread.
It is null for a thread the sidebar does not hold (unknown, deleted, archived
until an archived read loads it, or before the first load); read
`useSdk().threads.get` for those, as bb's parent-thread segment does.
