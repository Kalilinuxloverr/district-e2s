// DEV: Werte des
// Geraets zum Ablesen,
// im Menue BLECH unter
// DEV. Eine Seite je
// Wert, das Rad aendert
// nichts.
//
// POWER: Netzteil oder
// Batterie.
// BATTERY: Ladestand
// in Stufen 0 bis 4.
// HEAP: freier und
// belegter Speicher
// der Firmware in KB.
// SAMPLE: belegte und
// freie Sekunden von
// 270.
// SD CARD MB, die
// Versionen von
// Korg, BLECH und
// Panel, PLUGIN PEAK:
// laengster Frame
// aller Plugins in
// Prozent von 5 ms.

// Needs DISTRICT API 27: korg.menu.group puts the pages into DEV, korg.menu.value and korg.menu.text show what was read,
// korg.read.ram reads the firmware's RAM. Every address is one of Korg's 2.02 on the red Electribe (sampler), with or without
// Hacktribe; where it comes from stands in district/docs/messungen/2026-11-13-plugin-api27.md. Nothing is written anywhere.
// One page that can change is read again each frame, so each is at most a third of a second old; the versions are read once;
// the sample memory is added up 8 slots a frame (the 981 slots in about 5 s). A page the dial moved gets its value back.
// The power and battery models of the firmware sit behind fixed pointers; the objects themselves move from one start to the
// next (upstream's measurement 2026-11-11-plugin-api34-system.md; checked in the emulator 2026-11-13: +0x308 follows the
// adapter message both ways). The battery level is never sent by the emulator: on the device it is derived, not measured.
const POWER_PTR = 0xC03405C4;   // -> +0x308: 1 on the mains adapter, 0 on batteries
const BATTERY_PTR = 0xC03405C8; // -> +0x328: the level 0 (empty) to 4 the firmware's thresholds give
const RAM_LO = 0xC0000000;      // korg.read.ram reads only here; a pointer that is not set yet must not be followed
const RAM_HI = 0xC7FFFFFC;
const HEAP_TOP = 0xC03404AC;    // the end of what the firmware's heap has handed out
const HEAP_FROM = 0xC06A2940;
const HEAP_TO = 0xC08A2940;
const META = 0xC036AD88;        // the sample table, 0x45C bytes a sample (index = slot - 1): +4 the bytes of its PCM data
const META_STEP = 0x45C;
const SLOTS = 999;
const FIRST = 18;               // the indices below are the oscillator waveforms
const SECOND = 96000;           // bytes of a second: 48 kHz, 16 bit, mono
const TOTAL = 270;              // the seconds the device holds, factory samples included
const CARD = 0xC031BEA0;        // the card's size in sectors of 512 bytes, 0 without a card
const BLECH = 0xC014FCF0;       // the text "BLECH 1.4.5" of the set, FF without it
const PANEL = 0xC03404A8;       // byte: the version the panel controller answered with (0x96)
const RUNTIME = 0xC01AE000;     // the plugin runtime: +0 its first plugin; a plugin: +0 the next one, +144 the ticks of its longest frame
const FRAME_TICKS = 144;
const PERCENT = 7500;           // ticks of a percent of the 5 ms all plugins share (the timer counts 150 a microsecond)
const MENU = 0xC01D6E00;        // the BLECH menu: +40 the plugins loaded, +60 the pages plugins added
const TICKS = 0xC06A292C;       // milliseconds since the start

const P_POWER = 0;
const P_FREE = 1;
const P_USED = 2;
const P_SMP = 3;
const P_SMPFREE = 4;
const P_CARD = 5;
const P_PEAK = 6;
const P_PLUGINS = 7;
const P_PAGES = 8;
const P_UP = 9;
const P_BATT = 10;
const LIVE = 11;                // the pages above are read again and again, those below once
const P_KORG = 11;
const P_BLECH = 12;
const P_PANEL = 13;
const N = 14;
const pg = new Array(14);       // the page's number, -1 when the menu had no place left
const val = new Array(14);      // what it shows, -1 nothing yet

pg[P_POWER] = korg.menu.add("POWER", 0, 1, 0);
pg[P_BATT] = korg.menu.add("BATTERY", 0, 4, 0);
pg[P_FREE] = korg.menu.add("HEAP FREE KB", 0, 999999, 0);
pg[P_USED] = korg.menu.add("HEAP USED KB", 0, 999999, 0);
pg[P_SMP] = korg.menu.add("SAMPLE USED S", 0, 999999, 0);
pg[P_SMPFREE] = korg.menu.add("SAMPLE FREE S", 0, 999999, 0);
pg[P_CARD] = korg.menu.add("SD CARD MB", 0, 999999, 0);
pg[P_PEAK] = korg.menu.add("PLUGIN PEAK %", 0, 999999, 0);
pg[P_PLUGINS] = korg.menu.add("PLUGINS", 0, 999999, 0);
pg[P_PAGES] = korg.menu.add("MENU PAGES", 0, 999999, 0);
pg[P_UP] = korg.menu.add("UPTIME MIN", 0, 999999, 0);
pg[P_KORG] = korg.menu.add("KORG VERSION", 0, 999999, 202);
pg[P_BLECH] = korg.menu.add("BLECH VERSION", 0, 999999, 0);
pg[P_PANEL] = korg.menu.add("PANEL VERSION", 0, 999999, 0);
for (let k = 0; k < N; k++) {
  korg.menu.group(pg[k], "DEV");
  val[k] = -1;
}
// Korg's version is no value in RAM: the set only goes onto 2.02, so the page names that
korg.menu.text(pg[P_KORG], "2.02");
korg.menu.text(pg[P_SMP], "SCAN");
korg.menu.text(pg[P_SMPFREE], "SCAN");

let turn = 0;                   // the page read in this frame
let slot = FIRST;               // the sample slot the sum has come to
let sum = 0;                    // bytes of PCM data so far in this round

// the page shows the number, only told when it changed (a page on the display is drawn again by the call)
function show(k, v) {
  if (val[k] == v) return 0;
  val[k] = v;
  korg.menu.value(pg[k], v);
  return 0;
}

// byte `at` of the text of BLECH's version, read as whole words so a test can put them down
function letter(at) {
  return (korg.read.ram(BLECH + (at & ~3)) >> ((at & 3) * 8)) & 255;
}

// "BLECH 1.4.5" as 10405: two digits each for the second and third number; 0 without the text
function blech() {
  let part = 0;
  let out = 0;
  for (let at = 6; at < 16; at++) {
    let c = letter(at);
    if (c >= 48 && c <= 57) {
      part = part * 10 + c - 48;
    } else {
      out = out * 100 + part;
      part = 0;
      if (c != 46) return out;
    }
  }
  return out * 100 + part;
}

// the longest frame of every plugin so far, added up, in percent of the 5 ms they share
function peak() {
  let e = korg.read.ram(RUNTIME);
  let ticks = 0;
  for (let n = 0; n < 48 && e != 0 && e != -1; n++) {
    ticks += korg.read.ram(e + FRAME_TICKS);
    e = korg.read.ram(e);
  }
  return ticks / PERCENT;
}

// the word at `off` of the model behind `ptr`, -2 while the pointer does not point into RAM (-1 is "nothing shown yet")
function model(ptr, off) {
  let m = korg.read.ram(ptr);
  if (m < RAM_LO || m > RAM_HI - off) return -2;
  return korg.read.ram(m + off);
}

function read(k) {
  if (k == P_POWER) {
    let on = model(POWER_PTR, 0x308);
    if (val[k] != on) {
      val[k] = on;
      if (on == 1) korg.menu.text(pg[k], "ADAPTER");
      else if (on == 0) korg.menu.text(pg[k], "BATTERY");
      else korg.menu.text(pg[k], "?");
    }
  }
  if (k == P_BATT) {
    let lv = model(BATTERY_PTR, 0x328);
    if (val[k] != lv) {
      val[k] = lv;
      if (lv == 4) korg.menu.text(pg[k], "4/4");
      else if (lv == 3) korg.menu.text(pg[k], "3/4");
      else if (lv == 2) korg.menu.text(pg[k], "2/4");
      else if (lv == 1) korg.menu.text(pg[k], "1/4 NIEDRIG");
      else if (lv == 0) korg.menu.text(pg[k], "LEER");
      else korg.menu.text(pg[k], "?");
    }
  }
  if (k == P_FREE) show(k, (HEAP_TO - korg.read.ram(HEAP_TOP)) >> 10);
  if (k == P_USED) show(k, (korg.read.ram(HEAP_TOP) - HEAP_FROM) >> 10);
  if (k == P_CARD) {
    let mb = (korg.read.ram(CARD) >> 11) & 0x1FFFFF;
    if (val[k] != mb) {
      if (mb == 0) korg.menu.text(pg[k], "NO CARD");
      else korg.menu.text(pg[k], "");
    }
    show(k, mb);
  }
  if (k == P_PEAK) show(k, peak());
  if (k == P_PLUGINS) show(k, korg.read.ram(MENU + 40));
  if (k == P_PAGES) show(k, korg.read.ram(MENU + 60));
  if (k == P_UP) show(k, korg.read.ram(TICKS) / 60000);
  return 0;
}

// the versions do not change while the device is on
korg.onEvent("ready", () => {
  show(P_BLECH, blech());
  let v = korg.read.ram(PANEL) & 255;
  show(P_PANEL, (v >> 4) * 10 + (v & 15));
});

korg.onEvent("frame", () => {
  read(turn);
  turn++;
  if (turn >= LIVE) turn = 0;
  for (let n = 0; n < 8; n++) {
    sum += korg.read.ram(META + slot * META_STEP + 4);
    slot++;
    if (slot >= SLOTS) {
      let used = sum / SECOND;
      if (val[P_SMP] == -1) {
        korg.menu.text(pg[P_SMP], "");
        korg.menu.text(pg[P_SMPFREE], "");
      }
      show(P_SMP, used);
      show(P_SMPFREE, TOTAL - used);
      slot = FIRST;
      sum = 0;
    }
  }
});

// the dial moved a page: it shows what was read again
korg.onEvent("menu", (id, value) => {
  for (let k = 0; k < N; k++) {
    if (pg[k] == id && val[k] != -1) korg.menu.value(id, val[k]);
  }
});
