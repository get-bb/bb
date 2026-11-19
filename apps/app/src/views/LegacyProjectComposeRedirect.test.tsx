// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, expect, it } from "vitest";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { useRootComposeProjectId } from "@/lib/root-compose-selection";
import { useWidgetVoiceEntry } from "@/lib/widget-voice-entry";
import { LegacyProjectComposeRedirect } from "./LegacyProjectComposeRedirect";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

function LegacyProjectRoute() {
  const { projectId } = useParams();
  return <LegacyProjectComposeRedirect projectId={projectId ?? ""} />;
}

function RootComposeProbe() {
  const location = useLocation();
  const [projectId] = useRootComposeProjectId();
  const voiceReady = useWidgetVoiceEntry();
  return (
    <>
      <output data-testid="path">{`${location.pathname}${location.search}`}</output>
      <output data-testid="project">{projectId}</output>
      <output data-testid="voice-ready">{String(voiceReady)}</output>
    </>
  );
}

it("opens the root composer for the project and keeps the widget voice request", async () => {
  render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={["/projects/proj_house?widgetVoice=1"]}>
        <Routes>
          <Route path="/projects/:projectId" element={<LegacyProjectRoute />} />
          <Route path="/" element={<RootComposeProbe />} />
        </Routes>
      </MemoryRouter>
    </Provider>,
  );

  expect(await screen.findByText("proj_house")).toBeTruthy();
  expect(await screen.findByText("true")).toBeTruthy();
  expect(screen.getByTestId("path").textContent).toBe("/");
});
