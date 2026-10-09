import { useLocation } from "react-router-dom";

export function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return (
    <output data-testid="location">{`${pathname}${search}${hash}`}</output>
  );
}
