import { createFileRoute } from "@tanstack/react-router";
import css from "../community/forms.css?url";
import { SurveyPage } from "../community/survey-page";
import { SURVEY_TITLE, surveyOrder } from "../community/survey";
import { siteHeadLinks } from "../landing/page-head";

export const Route = createFileRoute("/community/survey")({
  head: () => ({
    meta: [
      { title: SURVEY_TITLE },
      { name: "robots", content: "noindex, nofollow" },
    ],
    links: siteHeadLinks(css),
  }),
  loader: () => surveyOrder(),
  component: SurveyRoute,
});

function SurveyRoute() {
  return <SurveyPage order={Route.useLoaderData()} />;
}
