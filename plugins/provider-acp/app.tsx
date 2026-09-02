import {
  definePluginApp,
  Markdown,
  type PluginTimelineRendererProps,
} from "@get-bb/plugin-sdk/app";
import { ompAdvisorPayloadSchema } from "./src/advisor.js";

export function OmpAdvisorTimelineRenderer({
  payload,
  Original,
}: PluginTimelineRendererProps) {
  const advisor = ompAdvisorPayloadSchema.safeParse(payload);
  if (!advisor.success) {
    return <Original />;
  }
  if (advisor.data.output === null) {
    return null;
  }
  return (
    <div className="px-2 py-1">
      <Markdown content={advisor.data.output} className="text-sm" />
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.experimental_timelineRenderer({
    kind: "provider-acp/advisor",
    component: OmpAdvisorTimelineRenderer,
  });
});
