# semantic fixture

This project was authored originally for WP-73 parser tests and is covered by
this repository's license. It is not copied from KiCad or a third-party board.

The files use schematic format version `20231120` (KiCad 8). The fixture pins
that version deliberately so future `kicadts` format drift is distinguishable
from a parser regression. It contains two hierarchical sheets, a multi-unit
symbol, DNP metadata, custom MPN/manufacturer fields, a power symbol that must
be excluded, local labels, and one hierarchical connection.
