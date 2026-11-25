import { definePluginApp, experimental_lazy } from "@get-bb/plugin-sdk/app";

const ThreadOutline = experimental_lazy(
  () => import("./components/ThreadOutline"),
);

export default definePluginApp((app) => {
  app.slots.experimental_threadRailOutline({
    id: "outline",
    component: ThreadOutline,
  });
});
