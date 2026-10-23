import { ThreadTitle } from "./ThreadTitleMentions";

export default {
  title: "thread/Thread Title Fade",
};

const LONG_TITLE =
  "Investigate the sidebar title fade across narrow layouts and keep every meaningful part of this long thread title readable without an ellipsis";

export function Narrow() {
  return (
    <div className="flex w-[240px] flex-col gap-5 p-6">
      <ThreadTitle title={LONG_TITLE} panOverflow />
      <ThreadTitle title="Fix login" panOverflow />
      <ThreadTitle
        title="Review @project:bb with the team and write a detailed implementation plan that continues beyond the available row width"
        panOverflow
      />
    </div>
  );
}

export function Wide() {
  return (
    <div className="w-[620px] p-6">
      <ThreadTitle title={LONG_TITLE} panOverflow />
    </div>
  );
}
