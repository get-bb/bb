# custom-fields fixture

This project was originally authored from scratch for the Finite State plugin
by OpenAI Codex on 2026-08-13. Both schematic sheets were opened and saved with
the official KiCad 9.0.7 macOS schematic editor, which serializes its generator
version as `9.0`, and were validated through that release's CLI exports. The
board and project settings were loaded and saved through KiCad 9.0.7's Python
scripting API. It is not derived from any KiCad QA project or other third-party
fixture.

The schematic intentionally covers custom fields with MPN present and absent,
a DNP component, a two-unit part, a power symbol, a rotated symbol, a named
hierarchical sheet, and labeled plus unlabeled connectivity. The board contains
originally drawn footprints, a rotated footprint, custom fields, and routed
nets. Deterministic `15000000-...` UUIDs make review provenance clear.

These fixture files are licensed under this repository's MIT license.
