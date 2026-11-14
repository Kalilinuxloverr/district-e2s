# DISTRICT 0.2: Sample Swap im Fork, Startbild, Speicher und Sample-Aufrufe

Stand 13. November 2026. **Gemessen** im Emulator mit Korgs Original 2.02 rot (eigene Datei) und dem BLECH-Satz
`data/patches/blech.json`, der jetzt `sample-swap.json` enthält. Hacktribe und die blaue Electribe sind **nicht gelaufen**,
am Gerät ist **nichts** davon geprüft. Fälle: `tools/emu/swap_cases.py` (`case_start_image`, `case_plugin_sample_reads`),
`tools/emu/loadbar_cases.py`, Modelltests in `tools/patch/test_sample_swap.py`.

## Was zusammengeführt ist

| Teil | Herkunft |
|---|---|
| DISTRICT 0.1 mit API 27 | der Stand des Forks, als ein Commit auf Upstream v1.4.5 `9fe82cd` |
| Sample Swap | Upstreams `feature/sample-swap` `99ebf44c` (gemergt), dann sieben eigene Commits `34c0c62a` bis `ff91ad58` (cherry-pick, alle ohne Konflikt) |
| Version | `DISTRICT_VERSION` in `tools/patch/script_hooks.py`: `DISTRICT 0.2` |

`99ebf44c` bringt neben dem Swap Upstreams Stand von develop nach 1.4.5 mit (neue Effekte im Katalog, Navigationsleiste,
Pixelraster im Emulator). Die Plugin-Laufzeit bleibt API 27: der Swap ändert `data/script/contract.mjs` und die
`script_*.s` nicht, nur einen Kommentar in `script_menu.s`.

## Konflikte und Entscheidungen

| Stelle | Was | Entscheidung |
|---|---|---|
| `tools/emu/check.py` | Textkonflikt im Docstring, Liste der Fallmodule | beide Seiten: die Liste mit `plugin_api26_cases.py` und `plugin_api27_cases.py`, dahinter der Satz zu `swap_cases.py` |
| Startbild des Forks | lag als 1024 Byte bei `0xC01A3800`, der Swap schreibt Code von `0xC01A2FE0` bis `0xC01A3BC4` (`sample_swap.py:CODE1`) | **verlegt** nach `0xC01A4600` bis `0xC01A4A00` (`splash_editor.py:DEFAULT_AT`), siehe unten |
| Startwartezeit und Start des Swaps | beide am Start | keine Änderung am Code nötig, siehe unten; die Fälle des Swaps bekommen die 3 s mehr Zeit |
| Blechy-Block | Upstream kürzt ihn auf `0xC0186800` | unser Block endet bei `0xC01866D4`, passt |
| gebaute Dateien | `sample-swap.json`, `script-runtime*.json`, `splash-editor.json`, `data/emu/node-results.json` | neu gebaut mit den Werkzeugen des Forks und Korgs 2.02; `load-bar.json` und `node-results.json` aus dem Merge waren schon gleich, `verified.json` bleibt, wie es ist |

## Speicher

| Bereich | Besitzer | Befund |
|---|---|---|
| `0xC0184000` bis `0xC01866D4` | script-runtime, Blechy-Block | **Hergeleitet:** endet vor `0xC0186800`, dem Code der Swap-Persistenz |
| `0xC0186800` bis `0xC0188000`, `0xC0188540` bis `0xC0188740`, `0xC0189770` bis `0xC0189F00`, `0xC018A4E0` bis `0xC018AF00`, `0xC018BF40` bis `0xC018C400`, `0xC019A400` bis `0xC019E000` | sample-swap | Code, Zustand und freie Reste, laut Prüfung ohne Überschneidung |
| `0xC018D000` bis `0xC018DA40` | script-runtime (API 26 und 27) | `LOOK_HOLD`, `BOOT_CYCLE`, Menütabelle `0xC018D040` (64 mal 40 Byte); kein Bereich des Swaps |
| `0xC01A2FE0` bis `0xC01A3C00` | sample-swap | `CODE1`, hier lag vorher das Startbild |
| `0xC01A4600` bis `0xC01A4A00` | splash-editor | das Startbild des Forks; vorher Platz der Kartenbilder des Ladebilds (`load_bar.py:LOAD_END` jetzt `0xC01A4600`, die Bilder belegen `0x374` von `0x900` Byte) |
| `0xC274F000` bis `0xC4000000` | sample-swap | `HIGH`; darin neu der Katalog `0xC3FFB000` bis `0xC3FFEE80` (`CAT`), der obere Cache endet jetzt dort statt bei `0xC3FFF000` |

**Gemessen** (Prüfungen des Repos): `checkRam` und `checkRamPlacement` in `test/patch-ram.test.mjs`, 18 von 18 mit
`E2_VSB` und `E2_STOCK_VSB` auf Korgs 2.02, auch der Test, dass jeder Bereich im Abbild dort `FF` ist. Mit dem Startbild an
der alten Stelle meldet `checkRam` in beiden Builds `splash-editor ... 0xC01A3800..0xC01A3C00 overlaps sample-swap: sample swap:
code 0xC01A2FE0..0xC01A3BC4`, und `apply.mjs` lehnt den Satz ab. Eine erste Wahl `0xC01AD000` (hinter dem Fortschrittsbild des
Ladebilds) war in der Prüfung frei, brach aber zwei Upstream-Tests der Lage (`test/splash-editor.test.mjs`, `test/mfx-switch.test.mjs`:
Code und Daten des Editors unter `0xC01A4A00`).

## Startbild und Start des Swaps

Der Lader wartet in `splash_hold` (`load_bar.py`), bis die Uhr `SPLASH_MS` 3000 zeigt, und ruft dann den Lader der Firmware
auf. Die Haken des Swaps liegen danach im Lader (`0xC00364F4`, `0xC0036510`, `0xC00366D8`), der Pfad wird bei `0xC0038D50`
gemerkt, vor dem Aufruf. Damit kommt erst das Startbild, dann der Start des Swaps.

| Lauf | Befund |
|---|---|
| Swap an (Budget im Fall gesenkt) | **Gemessen:** Lader bei 3014 ms Betriebssystemzeit, Modus 1, im DSP nur die Samples des ersten Patterns (500, 501), zwei PCM- und acht Metadatenlesungen, Hauptbildschirm bei 5,85 s |
| EXIT beim Einschalten | **Gemessen:** Lader bei 197 ms, Modus 0 |
| kleine Datei, Startbild | **Gemessen:** Startbild von 90 bis 3192 ms, Lader bei 3167 ms, Hauptbildschirm bei 4386 ms (`loadbar:start_image_stays_three_seconds`) |
| große Bibliothek (45.870.030 Byte, echtes Budget) | **Gemessen:** Swap an, Wechsel beim Spielen und im Stopp wie in Upstreams Fällen |

Vier Fälle des Swaps (`case_user_library`, `case_user_library_tight`, `case_slow_card`, `case_card_pulled_while_playing`)
liefen zuerst über die 12 s, die `swap_cases.Box` bis zum Hauptbildschirm erlaubt. Die Grenze ist jetzt 12 s plus `SPLASH_MS`,
wenn die Kopie das Ladebild trägt; danach alle grün.

## Sample-Aufrufe unter Swap

`korg.read.sampleFrames`, `sampleRate` und `sampleTune` lasen die Zeile mit dem Index als Zeilennummer. Mit Swap hat ein
Sample, das nie im DSP war, eine leere Zeile.

| Fall | vorher (gemessen) | jetzt (gemessen) |
|---|---|---|
| im DSP seit dem Start | richtig (40000 Frames, 32225 Hz, Tune 0) | gleich |
| nie geladen | 0 Frames, 48000 Hz (die Period `0x3C00` eines leeren Platzes), Tune 0 | aus dem Katalog: 40000 bzw. 30000 Frames, 32225 Hz, Tune 0, auch nach drei Wechseln |
| aus dem DSP geräumt | die Zeile bleibt: richtig | gleich |
| nicht in der Datei | 0 Frames | 0 Frames |

Was dazu kam:

- **Zeile:** der Aufruf sucht die Zeile wie die Firmware (`sample_swap.py:physical`): Importnummer im Namenseintrag (`+30`),
  dann `0xC035738C`, `0xC035F06C`, `0xC0350644`; endet der Weg nirgends, der Index wie bisher. Die Period kommt aus dem Eintrag,
  den der Weg findet. Im Lauf waren Zeile und Index bei den Plätzen 501 bis 510 gleich.
- **Katalog:** der Namensdurchlauf des Swaps (`names_read`) schreibt für jeden Datensatz, den er liest und der nicht im DSP ist,
  16 Byte bei `CAT + Platz * 16`: Frames, die Rate des Datensatzes, Period und Tune, zuletzt `0xCA700000` plus Platz. Frames
  wie der Lader die Abspieltabelle füllt ([API 26](2026-11-12-plugin-api26.md)): Endpunkt ab Startpunkt, auf PCM-Länge minus ein
  Frame minus Start gekürzt. Die Felder des Deskriptors sind die von `esli` (`+0x22` Period, `+0x28` Start, `+0x30` Ende,
  `+0x3C` PCM-Länge, `+0x41` Stereo, `+0x48` Rate, `+0x4D` Tune), **gemessen** im Emulator an Platz 510 gegen die geladene Zeile 501.
- Die Laufzeit liest den Katalog nur, wenn die Zeile leer ist, das Wort `MODE` des Swaps (`0xC0188540`) 1 ist und die Marke
  stimmt. Im Satz als `shares` der Laufzeit beim Swap angegeben.
- **Offen:** ein verschobener Startpunkt, Stereo und Tune ungleich 0 sind nur im Modelltest geprüft, nicht im Emulatorlauf;
  Werksplätze am Gerät; ob die Zeile eines ausgeräumten Samples am Gerät ebenso stehen bleibt.

## Läufe

Auf `DISTRICT-0.2-swap.VSB`, sha256 `63baf0c5eca4d44f9810e8881caf1dd51b25978c9b153b59cb9d734993176ddd`, Korgs 2.02 rot mit
`blech.json`, `GELUMPE_JOBS=3`:

- `tools/emu/check.py` mit dem Befehl, den `apply.mjs` druckt, ohne `--flash` (alle Fallmodule): **1374 von 1374.** Darin 184
  Fälle `swap`, 22 `plugin_api26`, 15 `plugin_api27`, 26 `plugin_api25`, 47 `loadbar`, 9 `splash`.
- Davor `check.py ... --cases swap_cases`: 205 von 205.
- `npm test`: 1783 Tests, 1611 grün, 171 übersprungen, 1 rot: `test/e2e-harness.test.mjs`, weil das Paket `playwright` nicht
  installiert ist (der Test kam mit dem Swap, sein Harness lädt `playwright`).
- Modelltests des Swaps, 13 Module (`python -m unittest test_sample_swap test_sample_swap_io test_sample_store
  test_sample_snapshot test_sample_protection test_sample_owner test_sample_export_fault test_sample_versions
  test_native_sample_persistence test_native_dsp_scope test_native_dsp_acquire test_native_helpers test_capture_fault` in
  `tools/patch`, mit dem Repo im `PYTHONPATH`): 365 von 365.

Ein erster voller Lauf mit dem Katalog in `PROTECTION_CODE` ergab 1358 von 1360: die Proben von `case_file_owner` und
`case_integrity` (`reader_lifecycle_cases.py`, `swap_integrity_cases.py`) legen eigenen Code in den freien Rest dieser Fläche, und
der war auf `0x30` Byte geschrumpft. Der Namensdurchlauf mit seinem Katalog (`sample_names.py`) liegt jetzt in
`PERSISTENCE_CODE`; frei sind danach `0x388` Byte in `PROTECTION_CODE` und `0x5F4` in `PERSISTENCE_CODE`. Die Prüfung der
Bereiche (`test/patch-ram.test.mjs` mit Korgs 2.02) bleibt 18 von 18.
