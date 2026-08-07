import path from "node:path";
import { ApiError } from "../../errors.js";

const REPO_DIR_NAME_PATTERN = /^[A-Za-z0-9._][A-Za-z0-9._-]*$/;

// Curated from the REST Countries capital data. Keep this list local so
// worktree creation never depends on a network service.
export const CAPITAL_CITY_WORKTREE_NAMES = [
  "abu-dhabi",
  "abuja",
  "accra",
  "addis-ababa",
  "algiers",
  "amman",
  "amsterdam",
  "andorra-la-vella",
  "ankara",
  "antananarivo",
  "apia",
  "asmara",
  "astana",
  "asuncion",
  "athens",
  "baghdad",
  "baku",
  "bamako",
  "bandar-seri-begawan",
  "bangkok",
  "bangui",
  "banjul",
  "basseterre",
  "beijing",
  "beirut",
  "belgrade",
  "belmopan",
  "berlin",
  "bern",
  "bishkek",
  "bissau",
  "bogota",
  "brasilia",
  "bratislava",
  "brazzaville",
  "bridgetown",
  "brussels",
  "bucharest",
  "budapest",
  "buenos-aires",
  "cairo",
  "canberra",
  "caracas",
  "castries",
  "chisinau",
  "conakry",
  "copenhagen",
  "dakar",
  "damascus",
  "dhaka",
  "dili",
  "djibouti",
  "dodoma",
  "doha",
  "dublin",
  "dushanbe",
  "funafuti",
  "gaborone",
  "georgetown",
  "guatemala-city",
  "hanoi",
  "harare",
  "havana",
  "helsinki",
  "honiara",
  "islamabad",
  "jakarta",
  "juba",
  "kabul",
  "kampala",
  "kathmandu",
  "khartoum",
  "kigali",
  "kingston",
  "kingstown",
  "kinshasa",
  "kuala-lumpur",
  "kuwait-city",
  "kyiv",
  "libreville",
  "lilongwe",
  "lima",
  "lisbon",
  "ljubljana",
  "lome",
  "london",
  "luanda",
  "lusaka",
  "luxembourg",
  "madrid",
  "majuro",
  "malabo",
  "male",
  "managua",
  "manama",
  "manila",
  "maputo",
  "maseru",
  "mbabane",
  "mexico-city",
  "minsk",
  "mogadishu",
  "monaco",
  "monrovia",
  "montevideo",
  "moroni",
  "moscow",
  "muscat",
  "nairobi",
  "nassau",
  "naypyidaw",
  "ndjamena",
  "new-delhi",
  "ngerulmud",
  "niamey",
  "nicosia",
  "nouakchott",
  "nukualofa",
  "oslo",
  "ottawa",
  "ouagadougou",
  "palikir",
  "panama-city",
  "paramaribo",
  "paris",
  "phnom-penh",
  "podgorica",
  "port-au-prince",
  "port-louis",
  "port-moresby",
  "port-of-spain",
  "porto-novo",
  "prague",
  "praia",
  "pretoria",
  "pyongyang",
  "quito",
  "rabat",
  "reykjavik",
  "riga",
  "riyadh",
  "rome",
  "roseau",
  "saint-georges",
  "saint-johns",
  "san-jose",
  "san-marino",
  "san-salvador",
  "sanaa",
  "santiago",
  "santo-domingo",
  "sao-tome",
  "sarajevo",
  "seoul",
  "singapore",
  "skopje",
  "sofia",
  "south-tarawa",
  "stockholm",
  "sucre",
  "suva",
  "tallinn",
  "tashkent",
  "tbilisi",
  "tegucigalpa",
  "tehran",
  "thimphu",
  "tirana",
  "tokyo",
  "tripoli",
  "tunis",
  "ulan-bator",
  "vaduz",
  "valletta",
  "vatican-city",
  "victoria",
  "vienna",
  "vientiane",
  "vilnius",
  "warsaw",
  "washington",
  "wellington",
  "windhoek",
  "yamoussoukro",
  "yaounde",
  "yerevan",
  "zagreb",
] as const;

interface AllocateCapitalCityWorktreeNameArgs {
  seed: string;
  usedNames: readonly string[];
  capitalNames?: readonly string[];
}

function stableStringHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function allocateCapitalCityWorktreeName(
  args: AllocateCapitalCityWorktreeNameArgs,
): string {
  const capitalNames = args.capitalNames ?? CAPITAL_CITY_WORKTREE_NAMES;
  if (capitalNames.length === 0) {
    throw new Error("At least one capital-city worktree name is required");
  }

  const usedNames = new Set(args.usedNames.map((name) => name.toLowerCase()));
  const startIndex = stableStringHash(args.seed) % capitalNames.length;
  for (let suffix = 1; ; suffix += 1) {
    for (let offset = 0; offset < capitalNames.length; offset += 1) {
      const capitalName =
        capitalNames[(startIndex + offset) % capitalNames.length];
      if (!capitalName) continue;
      const candidate = suffix === 1 ? capitalName : `${capitalName}-${suffix}`;
      if (!usedNames.has(candidate)) return candidate;
    }
  }
}

export function deriveRepoDirName(sourcePath: string): string {
  const trimmed = sourcePath.replace(/\/+$/, "");

  const scpMatch = /^[^:/]+@[^:]+:(?<path>.+)$/.exec(trimmed);
  const pathPart =
    scpMatch?.groups?.path ?? tryParseUrlPath(trimmed) ?? trimmed;

  const basename = path.posix.basename(pathPart);
  const candidate = basename.endsWith(".git")
    ? basename.slice(0, -".git".length)
    : basename;

  if (
    !candidate ||
    candidate === "." ||
    candidate === ".." ||
    !REPO_DIR_NAME_PATTERN.test(candidate)
  ) {
    throw new ApiError(
      400,
      "invalid_request",
      `Cannot derive repository directory name from source "${sourcePath}"`,
    );
  }
  return candidate;
}

function tryParseUrlPath(value: string): string | null {
  try {
    const url = new URL(value);
    if (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "ssh:"
    ) {
      return url.pathname;
    }
  } catch {
    // not a URL
  }
  return null;
}

export interface ResolveManagedTargetPathArgs {
  dataDir: string;
  sourcePath: string;
  worktreeName: string;
}

export interface ResolvePersonalTargetPathArgs {
  dataDir: string;
  environmentId: string;
}

export function resolveManagedTargetPath(
  args: ResolveManagedTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "worktrees",
    args.worktreeName,
    deriveRepoDirName(args.sourcePath),
  );
}

export function resolvePersonalTargetPath(
  args: ResolvePersonalTargetPathArgs,
): string {
  return path.posix.join(
    args.dataDir,
    "personal-workspaces",
    args.environmentId,
  );
}
