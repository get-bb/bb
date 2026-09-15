export const MAX_THREAD_HIERARCHY_DEPTH = 4;

export function canThreadAtHierarchyDepthSpawnChild(
  hierarchyDepth: number,
): boolean {
  return hierarchyDepth < MAX_THREAD_HIERARCHY_DEPTH;
}
