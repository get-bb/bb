import type { ComponentProps } from "react";
import { Link } from "react-router-dom";
import { InfoListRow as SharedInfoListRow } from "@bb/shared-ui/info-list";
export * from "@bb/shared-ui/info-list";
const CoreInfoLink: NonNullable<
  ComponentProps<typeof SharedInfoListRow>["linkComponent"]
> = ({ href, ...props }) => <Link to={href} {...props} />;
export function InfoListRow(props: ComponentProps<typeof SharedInfoListRow>) {
  return <SharedInfoListRow {...props} linkComponent={CoreInfoLink} />;
}
