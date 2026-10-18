import type { ReactNode } from "react";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { SidebarThreadEntriesProvider } from "@/lib/sidebar-thread-entries";

export function SidebarThreadEntriesTestProvider({
  children,
}: {
  children: ReactNode;
}) {
  const { data } = useSidebarNavigation();
  return (
    <SidebarThreadEntriesProvider navigation={data}>
      {children}
    </SidebarThreadEntriesProvider>
  );
}
