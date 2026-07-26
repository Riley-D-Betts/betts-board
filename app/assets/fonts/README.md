# Bundled fonts

These are self-hosted so the board works with no internet access and so no
page view is ever reported to a font CDN. Latin subset only, regular (400) and
bold (700) — the browser downloads only the family actually in use, so having
eight available costs nothing at runtime (271 KB total on disk).

Households can also add any other Google Font from **Settings → Appearance**;
that one is downloaded once by the server and served from the data volume.

| Family | Licence | Source |
| --- | --- | --- |
| Inter | SIL Open Font License 1.1 | fonts.google.com/specimen/Inter |
| Nunito | SIL Open Font License 1.1 | fonts.google.com/specimen/Nunito |
| Poppins | SIL Open Font License 1.1 | fonts.google.com/specimen/Poppins |
| Lexend | SIL Open Font License 1.1 | fonts.google.com/specimen/Lexend |
| Fredoka | SIL Open Font License 1.1 | fonts.google.com/specimen/Fredoka |
| Atkinson Hyperlegible | SIL Open Font License 1.1 | fonts.google.com/specimen/Atkinson+Hyperlegible |
| Lora | SIL Open Font License 1.1 | fonts.google.com/specimen/Lora |
| JetBrains Mono | SIL Open Font License 1.1 | fonts.google.com/specimen/JetBrains+Mono |

All eight are licensed under the [SIL Open Font License 1.1](https://openfontlicense.org),
which permits redistribution — including bundled in software — provided the
licence travels with the fonts. `OFL.txt` in this directory carries the full
licence text; each family retains its own copyright holder (the copy here was
taken from the Inter distribution, so its copyright line names that project —
the licence terms are identical for all eight, and the per-family copyright is
listed on each specimen page above). The OFL is compatible with this project's
AGPL-3.0 licence; the fonts remain under the OFL, not the AGPL.

Atkinson Hyperlegible is included deliberately: it was designed by the Braille
Institute to keep letterforms distinguishable at low acuity and from across a
room, which suits a kitchen wall display.

To refresh or add a family, see `app/assets/css/main.css` for the `@font-face`
blocks and `shared/schemas/fonts.ts` for the picker registry.
