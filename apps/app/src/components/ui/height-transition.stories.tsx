import { useState } from "react";
import { BottomAnchoredScrollBody } from "./bottom-anchored-scroll-body";
import { AutoHeightContainer, HeightTransition } from "./height-transition";

export default { title: "ui/Height transition" };

export function ScrollAnchoring() {
  const [leadingGrowth, setLeadingGrowth] = useState(0);
  const [trailingGrowth, setTrailingGrowth] = useState(0);
  const [leadingVisible, setLeadingVisible] = useState(true);
  const [trailingVisible, setTrailingVisible] = useState(true);
  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex flex-wrap gap-3 border-b border-border-seam p-3 text-sm">
        <button onClick={() => setLeadingGrowth((height) => height + 80)}>
          Grow above
        </button>
        <button onClick={() => setTrailingGrowth((height) => height + 80)}>
          Grow latest
        </button>
        <button onClick={() => setTrailingGrowth(0)}>Shrink latest</button>
        <button onClick={() => setLeadingVisible((value) => !value)}>
          Toggle above disclosure
        </button>
        <button onClick={() => setTrailingVisible((value) => !value)}>
          Toggle latest disclosure
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <BottomAnchoredScrollBody
          footer={null}
          maxWidthClassName="max-w-3xl"
          contentClassName="!p-4"
        >
          <AutoHeightContainer>
            {Array.from({ length: 30 }, (_, index) => (
              <div
                key={index}
                data-timeline-row-id={`height-row-${index}`}
                className="border-b border-border-seam p-3 text-sm"
              >
                <div
                  style={{
                    height:
                      80 +
                      (index === 0 ? leadingGrowth : 0) +
                      (index === 29 ? trailingGrowth : 0),
                  }}
                >
                  Response {index + 1}
                </div>
                {index === 0 && (
                  <HeightTransition visible={leadingVisible}>
                    <div style={{ height: 48 }}>Earlier disclosure content</div>
                  </HeightTransition>
                )}
                {index === 29 && (
                  <HeightTransition visible={trailingVisible}>
                    <div style={{ height: 48 }}>Latest disclosure content</div>
                  </HeightTransition>
                )}
              </div>
            ))}
          </AutoHeightContainer>
        </BottomAnchoredScrollBody>
      </div>
    </div>
  );
}
