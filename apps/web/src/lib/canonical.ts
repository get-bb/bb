export function canonicalHref(
  matches: ReadonlyArray<{
    pathname: string;
    status: string;
    globalNotFound?: boolean;
    staticData: { ownsCanonical?: boolean };
  }>,
) {
  const page = matches.at(-1);
  if (
    page === undefined ||
    matches.some(
      (match) =>
        match.status === "notFound" ||
        match.globalNotFound === true ||
        match.staticData.ownsCanonical === true,
    )
  ) {
    return null;
  }
  const path = page.pathname === "/" ? "/" : page.pathname.replace(/\/+$/, "");
  return `https://getbb.app${path}`;
}
