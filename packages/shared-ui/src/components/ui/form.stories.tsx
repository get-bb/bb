import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "./button.js";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "./form.js";
import { Input } from "./input.js";
import { StoryCard, StoryRow } from "../../lib/story-card";

export default {
  title: "shared-ui/Form",
};

interface ProjectFormValues {
  name: string;
}

function ProjectNameFormDemo() {
  const form = useForm<ProjectFormValues>({ defaultValues: { name: "" } });

  useEffect(() => {
    void form.trigger();
  }, [form]);

  return (
    <Form {...form}>
      <form className="w-72 space-y-4" onSubmit={form.handleSubmit(() => {})}>
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "A project name is required." }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>Project name</FormLabel>
              <FormControl>
                <Input {...field} placeholder="my-project" />
              </FormControl>
              <FormDescription>Used as the default branch prefix.</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" size="sm">
          Create project
        </Button>
      </form>
    </Form>
  );
}

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="Required-field validation">
        <ProjectNameFormDemo />
      </StoryRow>
    </StoryCard>
  );
}
