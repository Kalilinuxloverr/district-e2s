// AUDIO IN: die Schalter
// der Audio-In-Funktionen
// in der Firmware
// (DISTRICT 0.3.2). Das
// Plugin haelt nur die
// Werte, die Arbeit macht
// die Firmware.
//
// AUDIO IN PAD: MONO oder
// STEREO, im TRIGGER-Modus
// schaltet Pad 16 Audio In
// auf Part 16 ein, nochmal
// aus. MONO ist Korgs
// Oszillator 017, STEREO
// 018. AUS: Pad 16 wie
// immer.
//
// AUDIO IN PEGEL: der
// Eingangspegel des
// eingerasteten Audio In,
// 0 bis 127 (Korgs OSC
// EDIT). Wirkt sofort.
//
// AUDIO IN PUFFER:
// Sekunden. EXIT + REC
// nimmt so lange Audio In
// auf und legt das neue
// Sample auf den
// gewaehlten Part.
// AUS: REC wie immer.
//
// PANIC: AN, EXIT + STOP
// beendet alle Stimmen.
//
// Unter BLECH >
// FEATURES.

// Needs DISTRICT 0.3.2 (the patch audio-in): the firmware looks these pages up by their names in FEATURES
// (script_shortcuts.s, menu_page_value), so the names must stay as they are. No frame handler: the plugin costs nothing per frame.
// store: 0 AUDIO IN PAD (0 off, 1 mono, 2 stereo; 0.3.1 kept 1 for on, which stays mono), 1 AUDIO IN PUFFER (seconds, 0 off),
// 2 PANIC, 3 AUDIO IN PEGEL
let pad = korg.menu.add("AUDIO IN PAD", 0, 2, korg.store.get(0, 2));
let level = korg.menu.add("AUDIO IN PEGEL", 0, 127, korg.store.get(3, 127));
let buf = korg.menu.add("AUDIO IN PUFFER", 0, 30, korg.store.get(1, 4));
let panic = korg.menu.add("PANIC", 0, 1, korg.store.get(2, 1));
korg.menu.group(pad, "FEATURES");
korg.menu.group(level, "FEATURES");
korg.menu.group(buf, "FEATURES");
korg.menu.group(panic, "FEATURES");

function padText(v) {
  if (v == 0) korg.menu.text(pad, "AUS");
  else if (v == 1) korg.menu.text(pad, "MONO");
  else korg.menu.text(pad, "STEREO");
  return 0;
}
function onOff(page, v) {
  if (v == 0) korg.menu.text(page, "AUS");
  else korg.menu.text(page, "AN");
  return 0;
}
// the seconds as a number, 0 as AUS
function seconds(v) {
  if (v == 0) korg.menu.text(buf, "AUS");
  else korg.menu.text(buf, "");
  return 0;
}
padText(korg.store.get(0, 2));
seconds(korg.store.get(1, 4));
onOff(panic, korg.store.get(2, 1));

korg.onEvent("menu", (id, value) => {
  if (id == pad) { padText(value); korg.store.set(0, value); }
  else if (id == level) korg.store.set(3, value);
  else if (id == buf) { seconds(value); korg.store.set(1, value); }
  else if (id == panic) { onOff(panic, value); korg.store.set(2, value); }
  else return;
  korg.store.save();
});
