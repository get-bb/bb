import Tick02Icon from "@hugeicons/core-free-icons/Tick02Icon";
import { HugeiconsIcon } from "@hugeicons/react";

import { ClaudeIcon, OpenAiIcon } from "../landing/icons";

export function PhoneApproval() {
  return (
    <div
      className="cmp-phone"
      role="img"
      aria-label="A push notification on a phone, and the thread open to approve a command"
    >
      <div className="cmp-push">
        <span aria-hidden="true" className="bb-mark cmp-push-mark" />
        <span className="cmp-push-body">
          <span className="cmp-push-title">Add rate limiting to uploads</span>
          <span className="cmp-push-text">Approve command: pnpm test</span>
        </span>
        <span className="cmp-push-time">now</span>
      </div>
      <div className="cmp-screen">
        <div className="cmp-thread cmp-thread-waiting">
          <ClaudeIcon className="cmp-prov" />
          <span className="cmp-thread-title">Add rate limiting to uploads</span>
          <span className="cmp-thread-dot" />
        </div>
        <div className="cmp-thread cmp-thread-child">
          <OpenAiIcon className="cmp-prov" />
          <span className="cmp-thread-title">Review the rate limiter</span>
          <span className="cmp-thread-done">done</span>
        </div>
        <div className="cmp-approval">
          <span className="cmp-approval-label">Approval needed</span>
          <code className="cmp-approval-cmd">pnpm test</code>
          <div className="cmp-approval-actions">
            <span className="cmp-chip">Deny</span>
            <span className="cmp-chip">Allow for session</span>
            <span className="cmp-chip cmp-chip-primary">Allow once</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export type BrandLogo = { kind: "bb" } | { kind: "image"; src: string };

export function BrandMark({
  logo,
  className,
}: {
  logo: BrandLogo;
  className: string;
}) {
  if (logo.kind === "bb") {
    return <span aria-hidden="true" className={`bb-mark ${className}`} />;
  }
  return <img src={logo.src} alt="" className={className} />;
}

export type Plan = {
  name: string;
  logo: BrandLogo;
  price: string;
  period: string;
  items: string[];
};

export function PlanCompare({ plans }: { plans: Plan[] }) {
  return (
    <div className="cmp-plans">
      {plans.map((plan) => (
        <div
          key={plan.name}
          className={
            plan.logo.kind === "bb" ? "cmp-plan cmp-plan-bb" : "cmp-plan"
          }
        >
          <div className="cmp-plan-head">
            <BrandMark logo={plan.logo} className="cmp-plan-logo" />
            <span className="cmp-plan-name">{plan.name}</span>
          </div>
          <div className="cmp-plan-price">
            {plan.price}
            <span className="cmp-plan-period">{plan.period}</span>
          </div>
          <ul className="cmp-plan-items">
            {plan.items.map((item) => (
              <li key={item}>
                <HugeiconsIcon icon={Tick02Icon} className="cmp-plan-check" />
                {item}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
