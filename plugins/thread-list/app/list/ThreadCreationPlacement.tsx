import { createContext, useContext, type ReactNode } from "react";

const PlacementGroupContext = createContext("threads");

export function ThreadCreationPlacementScope({
  group,
  children,
}: {
  group: string;
  children: ReactNode;
}) {
  return (
    <PlacementGroupContext.Provider value={group}>
      {children}
    </PlacementGroupContext.Provider>
  );
}

export function useThreadCreationPlacement(sectionWhenUnpinned: string | null) {
  const group = useContext(PlacementGroupContext);
  return {
    pinned: group === "pinned",
    sectionId:
      group === "pinned"
        ? sectionWhenUnpinned
        : group.startsWith("section:")
          ? group.slice("section:".length)
          : null,
  };
}
