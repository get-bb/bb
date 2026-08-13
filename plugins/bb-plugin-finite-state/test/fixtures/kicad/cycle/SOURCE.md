# cycle fixture

Original KiCad 8-format hierarchical-sheet fragments authored for WP-73 using
format version `20231120`. `cycle.kicad_sch` references `child.kicad_sch`,
which references the root again; the parser must reject the named cycle.
