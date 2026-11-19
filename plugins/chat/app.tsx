import { definePluginApp } from "@get-bb/plugin-sdk/app";
import { ChatPage } from "./app/ChatPage";

export default definePluginApp((app) => {
  app.slots.experimental_page({
    id: "chat",
    title: "Chat",
    description: "A conversation list and a chat in place of bb's workspace.",
    routes: ["home", "thread"],
    chrome: { sidebar: "hidden" },
    component: ChatPage,
  });
});
