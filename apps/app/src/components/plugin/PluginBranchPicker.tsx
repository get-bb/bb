import { useCallback, useState } from "react";
import type { BranchPickerProps } from "@get-bb/plugin-sdk";
import { BranchPicker } from "@/components/pickers/BranchPicker";
import { usePluginBranches } from "./usePluginBranchPickerState";

export function PluginBranchPicker({
  hostId,
  projectId,
  value,
  onChange,
  label,
  placeholder,
  disabled,
}: BranchPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const { branches, remoteBranches, isLoading, refresh } = usePluginBranches({
    hostId,
    projectId,
    query: searchQuery,
  });
  const enabled = hostId !== null && projectId !== null;
  const prefix = label === undefined ? "" : `${label} `;
  const emptyLabel = placeholder ?? "Select branch";
  const triggerLabel = value === null ? emptyLabel : `${prefix}${value}`;
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (open) void refresh().catch(() => undefined);
    },
    [refresh],
  );

  return (
    <BranchPicker
      variant="option"
      muted
      value={value}
      options={branches}
      remoteOptions={remoteBranches}
      loading={isLoading}
      placeholder={emptyLabel}
      triggerLabel={triggerLabel}
      triggerTitle={triggerLabel}
      menuLabel={label}
      disabled={!enabled || disabled === true}
      onChange={onChange}
      onOpenChange={handleOpenChange}
      onSearchQueryChange={setSearchQuery}
    />
  );
}
