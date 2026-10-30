# Collapsible stack card

`experimental_CollapsibleStackCard` is bb's collapsible card for the stack
above a thread's composer, the one bb's Plan mode card uses. Render it from a
thread-scoped composer banner with `chrome: "bare"`; plugin banners sit above
bb's own cards.

Props are `{ label, title, icon, isActive, dismiss?, children }`. `label`
names the card and its toggle; the header shows `icon` and `title` and toggles
`children`, and the card starts collapsed. `isActive` picks bb's working style
over the muted one. `dismiss` is `{ label, failureMessage, onDismiss }`: bb
disables the button with a spinner until `onDismiss()` settles and toasts the
error, falling back to `failureMessage`.

```tsx
import {
  experimental_CollapsibleStackCard as CollapsibleStackCard,
  experimental_useThreadExtensionState,
  useComposer,
  useSdk,
} from "@get-bb/plugin-sdk/app";

function GoalBanner() {
  const { scope } = useComposer();
  return scope.kind === "thread" ? <GoalCard threadId={scope.threadId} /> : null;
}

function GoalCard({ threadId }: { threadId: string }) {
  const sdk = useSdk();
  const goal = goalSchema.safeParse(
    experimental_useThreadExtensionState(threadId, "goal"),
  );
  if (!goal.success || goal.data === null) return null;
  return (
    <CollapsibleStackCard
      label="Goal"
      title={goal.data.status === "paused" ? "Goal paused" : "Goal"}
      icon="Target"
      isActive={goal.data.status === "active"}
      dismiss={{
        label: "Clear Goal",
        failureMessage: "Failed to clear Goal.",
        onDismiss: async () => {
          await sdk.threads.clearGoal({ threadId });
        },
      }}
    >
      <p>{goal.data.objective}</p>
    </CollapsibleStackCard>
  );
}

app.composer.customize({
  id: "goal",
  scopes: ["thread"],
  banners: [{ id: "goal", chrome: "bare", component: GoalBanner }],
});
```

`experimental_useThreadExtensionState(threadId, kind)` reads only your own
plugin's declared kinds, and only while bb shows the thread; it returns null
when there is no state. The Codex provider's Goal card works this way.
