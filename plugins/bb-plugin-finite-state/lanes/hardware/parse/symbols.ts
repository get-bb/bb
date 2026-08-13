import type { KicadSch, SchematicSymbol, SymbolPin } from "kicadts";

export interface ParsedSymbol {
  reference: string;
  unit: number;
  value: string | null;
  footprint: string | null;
  mpn: string | null;
  manufacturer: string | null;
  at: { x: number; y: number; angle: number | null };
  fields: Record<string, string>;
}

export interface ParsedSymbolPin {
  reference: string;
  pin: string;
  at: { x: number; y: number };
}

export interface SymbolExtraction {
  symbols: ParsedSymbol[];
  pins: ParsedSymbolPin[];
  missingPinGeometry: string[];
}

const STANDARD_PROPERTY_NAMES = new Set([
  "reference",
  "value",
  "footprint",
  "datasheet",
]);

function nonEmpty(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function propertyValue(symbol: SchematicSymbol, name: string): string | undefined {
  const expected = name.toLocaleLowerCase();
  return symbol.properties.find((property) =>
    property.key.toLocaleLowerCase() === expected)?.value;
}

function instanceReference(symbol: SchematicSymbol): string | undefined {
  for (const project of symbol.instances?.projects ?? []) {
    for (const path of project.paths) {
      if (path.reference?.trim()) return path.reference;
    }
  }
  return undefined;
}

function instanceUnit(symbol: SchematicSymbol): number | undefined {
  for (const project of symbol.instances?.projects ?? []) {
    for (const path of project.paths) {
      if (path.unit !== undefined) return path.unit;
    }
  }
  return undefined;
}

function librarySymbol(schematic: KicadSch, instance: SchematicSymbol): SchematicSymbol | undefined {
  return schematic.libSymbols?.symbols.find((candidate) =>
    candidate.libraryId === instance.libraryId || candidate.libraryName === instance.libraryId);
}

function isPowerSymbol(schematic: KicadSch, instance: SchematicSymbol): boolean {
  if (instance.libraryId?.toLocaleLowerCase().startsWith("power:")) return true;
  const library = librarySymbol(schematic, instance);
  return library?.getChildren().some((child) => child.token === "power") ?? false;
}

function customFields(symbol: SchematicSymbol): {
  fields: Record<string, string>;
  mpn: string | null;
  manufacturer: string | null;
} {
  const fields: Record<string, string> = {};
  let mpn: string | null = null;
  let manufacturer: string | null = null;
  for (const property of symbol.properties) {
    const lowerName = property.key.toLocaleLowerCase();
    if (STANDARD_PROPERTY_NAMES.has(lowerName)) continue;
    if (lowerName === "mpn") {
      mpn = nonEmpty(property.value);
      continue;
    }
    if (lowerName === "manufacturer") {
      manufacturer = nonEmpty(property.value);
      continue;
    }
    fields[property.key] = property.value;
  }
  if (symbol.dnp) fields.DNP = "true";
  return { fields, mpn, manufacturer };
}

function subSymbolUnit(symbol: SchematicSymbol): number | null {
  const name = symbol.libraryId ?? symbol.libraryName;
  const match = name ? /_(\d+)_\d+$/u.exec(name) : null;
  return match ? Number(match[1]) : null;
}

function pinsForUnit(library: SchematicSymbol, unit: number): SymbolPin[] {
  const pins = [...library.pins];
  for (const subSymbol of library.subSymbols) {
    const subUnit = subSymbolUnit(subSymbol);
    if (subUnit === 0 || subUnit === unit) pins.push(...subSymbol.pins);
  }
  return pins;
}

function transformPin(
  instance: SchematicSymbol,
  pin: SymbolPin,
): { x: number; y: number } | null {
  if (!instance.at || !pin.at) return null;
  const angle = instance.at.angle ?? 0;
  const matrix = angle === 0 ? { x1: 1, x2: 0, y1: 0, y2: -1 }
    : angle === 90 ? { x1: 0, x2: -1, y1: -1, y2: 0 }
    : angle === 180 ? { x1: -1, x2: 0, y1: 0, y2: 1 }
    : angle === 270 ? { x1: 0, x2: 1, y1: 1, y2: 0 }
    : null;
  if (!matrix) throw new Error(`KICAD_SYMBOL_ANGLE_INVALID: ${String(angle)}`);
  // KiCad composes a symbol mirror in library coordinates after applying the
  // schematic rotation. Library Y is up while schematic Y is down, hence the
  // default y2 = -1 transform above.
  if (instance.mirror === "x") {
    matrix.y1 = -matrix.y1;
    matrix.y2 = -matrix.y2;
  } else if (instance.mirror === "y") {
    matrix.x1 = -matrix.x1;
    matrix.x2 = -matrix.x2;
  } else if (instance.mirror !== undefined) {
    throw new Error(`KICAD_SYMBOL_MIRROR_INVALID: ${instance.mirror}`);
  }
  return {
    x: instance.at.x + matrix.x1 * pin.at.x + matrix.x2 * pin.at.y,
    y: instance.at.y + matrix.y1 * pin.at.x + matrix.y2 * pin.at.y,
  };
}

export function extractSymbols(schematic: KicadSch): SymbolExtraction {
  const symbols: ParsedSymbol[] = [];
  const pins: ParsedSymbolPin[] = [];
  const missingPinGeometry: string[] = [];

  for (const instance of schematic.symbols) {
    if (isPowerSymbol(schematic, instance)) continue;
    const reference = nonEmpty(propertyValue(instance, "Reference") ?? instanceReference(instance));
    if (!reference || reference.startsWith("#")) continue;
    if (!instance.at) throw new Error(`KICAD_SYMBOL_POSITION_MISSING: ${reference}`);
    const unit = instance.unit ?? instanceUnit(instance) ?? 1;
    if (!Number.isInteger(unit) || unit < 1) {
      throw new Error(`KICAD_SYMBOL_UNIT_INVALID: ${reference} has unit ${String(unit)}`);
    }
    const custom = customFields(instance);
    symbols.push({
      reference,
      unit,
      value: nonEmpty(propertyValue(instance, "Value")),
      footprint: nonEmpty(propertyValue(instance, "Footprint")),
      mpn: custom.mpn,
      manufacturer: custom.manufacturer,
      at: {
        x: instance.at.x,
        y: instance.at.y,
        angle: instance.at.angle ?? null,
      },
      fields: custom.fields,
    });

    const library = librarySymbol(schematic, instance);
    if (!library) {
      missingPinGeometry.push(`${reference}: embedded library symbol ${instance.libraryId ?? "<missing>"} not found`);
      continue;
    }
    const unitPins = pinsForUnit(library, unit);
    if (unitPins.length === 0) {
      missingPinGeometry.push(`${reference}: unit ${unit} has no embedded pin geometry`);
      continue;
    }
    for (const pin of unitPins) {
      const pinNumber = nonEmpty(pin.numberString);
      const at = transformPin(instance, pin);
      if (!pinNumber || !at) {
        missingPinGeometry.push(`${reference}: a unit ${unit} pin lacks a number or position`);
        continue;
      }
      pins.push({ reference, pin: pinNumber, at });
    }
  }

  return { symbols, pins, missingPinGeometry };
}
