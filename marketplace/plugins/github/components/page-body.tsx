import { cn } from "@/lib/utils";

export function PageBody({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className={cn("mx-auto w-full max-w-3xl space-y-4", className)}>
      {children}
    </div>
  );
}
