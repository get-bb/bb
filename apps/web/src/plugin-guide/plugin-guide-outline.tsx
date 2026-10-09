import {
  SURFACE_GROUPS,
  SURFACES_BY_ID,
  type PluginSurface,
  type SurfaceGroup,
} from "../../../../plugins/plugin-api-docs/src/surfaces";

function plainSurfaceCopy(text: string): string {
  return text
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([a-z0-9-]+\)/g, "$1")
    .replace(/\s*\{experimental\}/g, "")
    .trim();
}

function SurfaceOutline({
  surface,
  heading: Heading,
}: {
  surface: PluginSurface;
  heading: "h3" | "h4";
}) {
  return (
    <>
      <Heading>{surface.title}</Heading>
      <p>{plainSurfaceCopy(surface.summary)}</p>
      <ul>
        {surface.bullets.map((bullet) => (
          <li key={bullet}>{plainSurfaceCopy(bullet)}</li>
        ))}
      </ul>
    </>
  );
}

function GroupOutline({ group }: { group: SurfaceGroup }) {
  return (
    <section>
      <h2>{group.title}</h2>
      <p>{group.blurb}</p>
      {group.sections
        ? group.sections.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              {section.surfaceIds.flatMap((id) => {
                const surface = SURFACES_BY_ID.get(id);
                return surface
                  ? [<SurfaceOutline key={id} surface={surface} heading="h4" />]
                  : [];
              })}
            </section>
          ))
        : group.surfaces.map((surface) => (
            <SurfaceOutline key={surface.id} surface={surface} heading="h3" />
          ))}
    </section>
  );
}

export function PluginGuideOutline() {
  return (
    <div className="sr-only">
      {SURFACE_GROUPS.map((group) => (
        <GroupOutline key={group.id} group={group} />
      ))}
    </div>
  );
}
