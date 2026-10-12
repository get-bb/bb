import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { createProjectHandoff } from "./handoff.js";

export default definePluginApp((app) => {
  app.slots.experimental_projectAction({
    id: "export-handoff",
    order: 100,
    item: ({ project, sdk }) => ({
      label: "Export project handoff",
      icon: "FileText",
      async run() {
        const markdown = await createProjectHandoff(sdk, project.id);
        const url = URL.createObjectURL(
          new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
        );
        const link = document.createElement("a");
        link.href = url;
        link.download = `project-handoff-${project.id}.md`;
        document.body.append(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast.success(`Exported handoff for ${project.name}`);
      },
    }),
  });
});
