import { definePluginApp } from "@get-bb/plugin-sdk/app";
import type { PluginAppBuilder } from "@get-bb/plugin-sdk/app";
import { BrowserAnnotationController } from "./BrowserAnnotationController";
import {
  BrowserAnnotationAnnotateAction,
  BrowserAnnotationGrabAction,
  BrowserAnnotationScreenshotAction,
} from "./BrowserAnnotationToolbar";

export default definePluginApp((app: PluginAppBuilder) => {
  app.slots.experimental_browserAction({
    id: "screenshot",
    title: "Annotate screenshot",
    component: BrowserAnnotationScreenshotAction,
  });
  app.slots.experimental_browserAction({
    id: "grab",
    title: "Grab page element",
    component: BrowserAnnotationGrabAction,
  });
  app.slots.experimental_browserAction({
    id: "annotate",
    title: "Select and annotate page element",
    component: BrowserAnnotationAnnotateAction,
  });
  app.slots.experimental_browserController({
    id: "annotations",
    component: BrowserAnnotationController,
  });
});
