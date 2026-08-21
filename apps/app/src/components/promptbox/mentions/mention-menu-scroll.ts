import type { TypeaheadMenuState } from "@bb/client-core";

const COMMAND_LOAD_MORE_DISTANCE_PX = 48;

export function canLoadMoreCommandResults({
  hasMore,
  isError,
  isLoadingMore,
}: {
  hasMore: boolean;
  isError: boolean;
  isLoadingMore: boolean;
}): boolean {
  return hasMore && !isError && !isLoadingMore;
}

export function shouldLoadMoreCommandResults({
  trigger,
  scrollHeight,
  scrollTop,
  clientHeight,
}: {
  trigger: TypeaheadMenuState["trigger"];
  scrollHeight: number;
  scrollTop: number;
  clientHeight: number;
}): boolean {
  if (trigger !== "command") {
    return false;
  }

  return (
    scrollHeight - scrollTop - clientHeight <= COMMAND_LOAD_MORE_DISTANCE_PX
  );
}
