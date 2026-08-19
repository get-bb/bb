import type { EmptyStateProps } from "./empty-state";

type EmptyStateAcceptsChildren = "children" extends keyof EmptyStateProps
  ? true
  : false;

export const emptyStateOwnsItsContent: EmptyStateAcceptsChildren = false;
