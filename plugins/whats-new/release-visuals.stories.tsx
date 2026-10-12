import { ReleaseVisual } from "./release-visual.js";
import { RELEASE_VISUALS } from "./release-visuals.js";

export default {
  title: "plugins/What's new/Release visuals",
};

const VISUALS = Object.keys(RELEASE_VISUALS);

function Sheet({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      className={`${theme} grid grid-cols-[repeat(auto-fill,minmax(180px,1fr))] gap-x-6 gap-y-8 bg-background p-6 text-foreground`}
    >
      {VISUALS.map((visual) => (
        <div key={visual} className="flex min-w-0 flex-col gap-3">
          <div className="flex items-end gap-4">
            <ReleaseVisual visual={visual} />
            <ReleaseVisual visual={visual} className="size-10" />
          </div>
          <p className="text-xs text-subtle-foreground">{visual}</p>
        </div>
      ))}
    </div>
  );
}

export function AllVisuals() {
  return (
    <div className="flex flex-col">
      <Sheet theme="light" />
      <Sheet theme="dark" />
    </div>
  );
}
