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
          Active — shimmering download-circle
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
