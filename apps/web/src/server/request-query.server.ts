import { getRequest } from "@tanstack/react-start/server";

export function getRequestQuery(): string {
  return new URL(getRequest().url).search;
}
