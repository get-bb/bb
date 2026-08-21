import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { useMemo } from "react";
import { ListRow, Separator, useSheet } from "@/ui";
import { OptionSheet, type PickerOption } from "./OptionSheet";
import { PickerTrigger } from "./PickerTrigger";

interface ProjectPickerProject {
  id: string;
  name: string;
}

interface ProjectPickerProps {
  /** Ordinary projects in sidebar order. */
  projects: readonly ProjectPickerProject[];
  /** The personal project (listed last as the projectless choice). */
  personalProject: ProjectPickerProject | null;
  value: string;
  onChange: (projectId: string) => void;
  /** Adds a "New project…" row that hands off to the create flow. */
  onCreateProject?: () => void;
  disabled?: boolean;
  loading?: boolean;
  testID?: string;
}

/**
 * Compose project selector (mirrors apps/app ProjectSelector): the ordinary
 * projects, the personal project, and an entry point to create a project.
 */
export function ProjectPicker({
  projects,
  personalProject,
  value,
  onChange,
  onCreateProject,
  disabled,
  loading,
  testID = "project-picker",
}: ProjectPickerProps) {
  const sheet = useSheet();
  const options = useMemo((): PickerOption[] => {
    const rows: PickerOption[] = projects.map((project) => ({
      value: project.id,
      label: project.name,
      icon: "Folder",
    }));
    if (personalProject) {
      rows.push({
        value: personalProject.id,
        label: personalProject.name,
        description: "No repository; runs in the machine's personal workspace.",
        icon: "UserRound",
      });
    }
    return rows;
  }, [personalProject, projects]);
  const selected =
    projects.find((project) => project.id === value) ??
    (value === PERSONAL_PROJECT_ID || value === personalProject?.id
      ? personalProject
      : null);
  return (
    <>
      <PickerTrigger
        icon={selected?.id === personalProject?.id ? "UserRound" : "Folder"}
        label={selected?.name ?? "Project"}
        onPress={sheet.present}
        disabled={disabled}
        loading={loading}
        testID={testID}
        accessibilityLabel="Project"
      />
      <OptionSheet
        controller={sheet}
        title="Project"
        options={options}
        value={value}
        onChange={onChange}
        testIDPrefix={`${testID}-option`}
        emptyMessage="No projects yet."
        footer={
          onCreateProject ? (
            <>
              <ListRow
                title="New project…"
                leading="FolderPlus"
                trailing="chevron"
                onPress={() => {
                  sheet.dismiss();
                  onCreateProject();
                }}
                testID={`${testID}-create`}
              />
              <Separator />
            </>
          ) : undefined
        }
      />
    </>
  );
}
