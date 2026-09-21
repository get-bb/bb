import { useRef } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import {
  PLUGINS_ROUTE_PATH,
  SKILLS_ROUTE_PATH,
  SKILL_DETAIL_ROUTE_PATH,
  REGISTRY_SKILLS_ROUTE_PATH,
  REGISTRY_SKILL_DETAIL_ROUTE_PATH,
} from "@/lib/route-paths";
import { PluginsView, SkillsView } from "@/views/ToolsView";

export default function ResourcePaneView({ path }: { path: string }) {
  const location = useLocation();
  const paneLocation = useRef({ pathname: path, search: "", hash: "" });
  if (location.pathname === path) paneLocation.current = location;
  return (
    <Routes location={{ ...paneLocation.current, pathname: path }}>
      <Route path={PLUGINS_ROUTE_PATH} element={<PluginsView />} />
      <Route path={SKILLS_ROUTE_PATH} element={<SkillsView />} />
      <Route path={SKILL_DETAIL_ROUTE_PATH} element={<SkillsView />} />
      <Route path={REGISTRY_SKILLS_ROUTE_PATH} element={<SkillsView />} />
      <Route path={REGISTRY_SKILL_DETAIL_ROUTE_PATH} element={<SkillsView />} />
    </Routes>
  );
}
