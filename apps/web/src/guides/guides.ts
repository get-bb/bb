import type { Guide } from "./guide-types";
import { REMOTE_DEV_SERVERS } from "./pages/remote-dev-servers";

export const GUIDES: Guide[] = [REMOTE_DEV_SERVERS];

export function getGuide(slug: string): Guide | undefined {
  return GUIDES.find((guide) => guide.slug === slug);
}
