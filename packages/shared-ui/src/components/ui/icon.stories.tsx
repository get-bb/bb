import { Icon } from "./icon";

export default {
  title: "shared-ui/Icon",
};

export const Default = () => <Icon name="X" className="size-3.5" />;

export const Loading = () => (
  <Icon name="Spinner" className="size-4 animate-spin" />
);

export const Decorative = () => (
  <Icon name="Check" aria-hidden className="size-3.5" />
);

export const Small = () => <Icon name="X" className="size-3" />;

export const CopyIdle = () => <Icon name="Copy" />;

export const CopySuccess = () => <Icon name="Check" />;
