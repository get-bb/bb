import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { Rail, RailNewThreadButton } from "./app/Rail.js";
import { TopList } from "./app/TopList.js";

export default definePluginApp((app) => {
  app.slots.experimental_sidebarNavigation({
    id: "rail",
    title: "Rail",
    description: "Icons on the left edge",
    placement: "rail",
    component: Rail,
    headerComponent: RailNewThreadButton,
  });
  app.slots.experimental_sidebarNavigation({
    id: "top-list",
    title: "Top list",
    description: "Labeled rows above the thread list",
    placement: "list",
    component: TopList,
  });
});
