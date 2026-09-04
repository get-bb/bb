import { useNavigate } from "react-router-dom";
import { useAppCommandHandler } from "@/components/commands/AppCommandProvider";

export function BackToAppCommandHandler({
  routePath,
}: {
  routePath: string | null;
}) {
  const navigate = useNavigate();

  useAppCommandHandler(
    "app.back",
    () => {
      if (routePath === null) return false;
      void navigate(routePath);
      return true;
    },
    0,
    routePath !== null,
  );

  return null;
}
