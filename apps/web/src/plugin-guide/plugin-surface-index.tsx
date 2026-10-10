import type { MouseEvent } from "react";

import { plainSurfaceCopy } from "../../../../plugins/plugin-api-docs/src/surface-copy";
import {
  SURFACE_GROUPS,
  type PluginSurface,
} from "../../../../plugins/plugin-api-docs/src/surfaces";

function surfaceDescription(surface: PluginSurface): string {
  return plainSurfaceCopy(
    surface.summary.replace(/ With this, a plugin can:$/, ""),
  );
}

function pluginGuideSlideHref(slideId: string): string {
  return `/plugin-guide?slide=${encodeURIComponent(slideId)}`;
}

export function PluginSurfaceIndex({
  onOpenSlide,
}: {
  onOpenSlide?: (slideId: string) => void;
}) {
  const open = (slideId: string) => (event: MouseEvent<HTMLAnchorElement>) => {
    if (
      onOpenSlide === undefined ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    onOpenSlide(slideId);
  };
  return (
    <section className="surface-index" aria-labelledby="surface-index-title">
      <h2 id="surface-index-title">All plugin surfaces</h2>
      <p className="surface-index-sub">
        Every surface in the guide, with what it lets a plugin do.
      </p>
      <div className="surface-index-groups">
        {SURFACE_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`surface-index-${group.id}`}>
            <h3 id={`surface-index-${group.id}`}>
              <a href={pluginGuideSlideHref(group.id)} onClick={open(group.id)}>
                {group.title}
              </a>
            </h3>
            <ul>
              {group.surfaces.map((surface) => (
                <li key={surface.id}>
                  <span className="surface-index-name">{surface.title}</span>
                  <span className="surface-index-description">
                    {surfaceDescription(surface)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </section>
  );
}
