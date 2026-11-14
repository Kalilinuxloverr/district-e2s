// AUTO WRITE wie in der
// iPad-App: ist das
// Pattern ungespeichert
// und hast du die
// gewaehlte Zeit nichts
// angefasst, speichert
// es selbst auf seinen
// Platz.
//
// AUTO WRITE:
// 0 AUS, 1 2 S, 2 5 S,
// 3 10 S, 4 30 S.
// Unter BLECH >
// FEATURES.

// Needs DISTRICT (API 26): korg.read.unsaved() is the firmware's own compare, korg.quickSave() the way of EXIT + WRITE,
// which refuses by itself in a menu, while recording and while another pattern is viewed or waiting.
// Value names of the page AUTO WRITE, for the text call the firmware gets: OFF, 2 S, 5 S, 10 S, 30 S.
const SECONDS = [0, 2, 5, 10, 30];
// store: 0 the page's value (0 off, 1 to 4 a time)
let mode = korg.store.get(0, 1);
let page = korg.menu.add("AUTO WRITE", 0, 4, mode);
// API 27: the page sits in BLECH -> FEATURES and shows its value by name.
korg.menu.group(page, "FEATURES");
function modeText(v) {
  if (v == 0) korg.menu.text(page, "AUS");
  else if (v == 1) korg.menu.text(page, "2 S");
  else if (v == 2) korg.menu.text(page, "5 S");
  else if (v == 3) korg.menu.text(page, "10 S");
  else if (v == 4) korg.menu.text(page, "30 S");
  return 0;
}
modeText(mode);
let touched = 0;
let lastInput = 0;

function input() {
  lastInput = korg.millis();
  touched = 1;
  return 0;
}

korg.onEvent("knob", () => { input(); });
korg.onEvent("encoder", () => { input(); });
korg.onEvent("pad", () => { input(); });
korg.onEvent("touch", () => { input(); });
korg.onEvent("buttonPress", () => { input(); });
korg.onEvent("patternChange", () => { touched = 0; });

korg.onEvent("menu", (id, value) => {
  if (id != page) return;
  mode = value;
  modeText(value);
  korg.store.set(0, value);
  korg.store.save();
});

korg.onEvent("frame", () => {
  // only after an edit by hand, so a difference nobody made on the panel is never written
  if (mode == 0 || touched == 0) return;
  if (korg.millis() - lastInput < SECONDS[mode] * 1000) return;
  if (korg.read.unsaved() == 0) return;
  if (korg.quickSave() == 1) touched = 0;
});
