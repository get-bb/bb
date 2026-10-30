import { createFileRoute } from "@tanstack/react-router";
import css from "../community/forms.css?url";
import { SurveyPage } from "../community/survey-page";
import { siteHeadLinks } from "../landing/page-head";

const SURVEY_TITLE = "Help shape the future of bb!";

export const Route = createFileRoute("/community/survey")({
  head: () => ({
    meta: [
      { title: SURVEY_TITLE },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: siteHeadLinks(css),
  }),
  loader: () =>
    import("../community/survey").then((survey) => survey.surveyOrder()),
  component: SurveyRoute,
});

function SurveyRoute() {
  return <SurveyPage title={SURVEY_TITLE} order={Route.useLoaderData()} />;
}
