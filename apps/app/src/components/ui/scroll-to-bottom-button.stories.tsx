import { ScrollToBottomButton } from "./scroll-to-bottom-button";

export default {
  title: "ui/ScrollToBottomButton",
};

const noop = () => {};

// In the real timeline the button floats above the composer via a -mt-20 offset
// and an h-0 container; the padding here just gives the story room to show it.
export function Overview() {
  return (
    <div className="flex gap-16 px-8 pb-8 pt-28">
      <div className="flex flex-col items-center gap-3">
        <ScrollToBottomButton visible active={false} onClick={noop} />
        <span className="text-xs text-muted-foreground">Idle — scrolled up</span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <ScrollToBottomButton visible active onClick={noop} />
        <span className="text-xs text-muted-foreground">
          Active — shimmering arrow
        </span>
      </div>
      <div className="flex flex-col items-center gap-3">
        <ScrollToBottomButton visible={false} active onClick={noop} />
        <span className="text-xs text-muted-foreground">
          Hidden (at bottom)
        </span>
      </div>
    </div>
  );
}

// The button as it appears in a thread: floating just above the composer,
// overlaying the conversation, when the user has scrolled up.
function MockTimelineFrame({
  active,
  label,
}: {
  active: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex h-80 w-72 flex-col overflow-hidden rounded-lg border border-border bg-background">
        <div className="flex-1 space-y-3 overflow-hidden p-3">
          <div className="ml-auto w-3/5 rounded-md bg-surface-recessed p-2 text-sm text-foreground">
            Can you summarize the diff?
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-11/12 rounded bg-muted" />
            <div className="h-3 w-full rounded bg-muted" />
            <div className="h-3 w-4/5 rounded bg-muted" />
          </div>
          <div className="ml-auto w-1/2 rounded-md bg-surface-recessed p-2 text-sm text-foreground">
            And the tests?
          </div>
          <div className="space-y-1.5">
            <div className="h-3 w-3/4 rounded bg-muted" />
            <div className="h-3 w-5/6 rounded bg-muted" />
          </div>
        </div>
        <ScrollToBottomButton visible active={active} onClick={noop} />
        <div className="border-t border-border p-2">
          <div className="h-9 rounded-md border border-border bg-surface-recessed" />
        </div>
      </div>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export function InThread() {
  return (
    <div className="flex gap-10 p-8">
      <MockTimelineFrame active={false} label="Idle — scrolled up" />
      <MockTimelineFrame active label="Active — agent working" />
    </div>
  );
}
