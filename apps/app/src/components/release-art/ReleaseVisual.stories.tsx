import { RELEASE_META } from "@/components/settings/changelog-preview";
import { ReleaseVisual } from "./ReleaseVisual";

export default {
  title: "settings/Updates/Release visuals",
};

const RELEASES = Object.entries(RELEASE_META);

function Sheet({ theme }: { theme: "light" | "dark" }) {
  return (
    <div
      className={`${theme} grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-6 gap-y-8 bg-background p-6 text-foreground`}
    >
      {RELEASES.map(([version, meta]) => (
        <div key={version} className="flex min-w-0 flex-col gap-3">
          <div className="flex items-end gap-4">
            <ReleaseVisual visual={meta.visual} />
            <ReleaseVisual visual={meta.visual} className="size-10" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-subtle-foreground">
              {version} · {meta.visual ?? "no visual"}
            </p>
            <p className="mt-0.5 text-sm font-medium leading-snug">
              {meta.headline}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function AllReleases() {
  return (
    <div className="flex flex-col">
      <Sheet theme="light" />
      <Sheet theme="dark" />
    </div>
  );
}
