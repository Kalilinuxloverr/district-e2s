// Tests for plugins/api26/Takt.js (the app TAKT-ZAEHLER) in the fork's simulator: what the display shows.
// Run from the project root: DISTRICT_DIR=out/district-api26 node plugins/api26/Takt.test.mjs
// The big digits are read back the way an eye reads a seven segment digit: one point in the middle of each segment.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, SimDevice, probe, key, fork, press, release, source, KEY_NAMES } from "../../tools/plugins/sim-kit.mjs";

const load = p => import(pathToFileURL(join(fork, p)).href);
const { Display } = await load("src/script/display.mjs");
const { describeSource, packBlech } = await load("src/script/archive.mjs");
const { markProbed } = await load("src/script/blob.mjs");
const { PATTERN_FIELDS, ARCHIVE, DESC_TRAILER, SCRIPT_APPS } = await load("data/script/contract.mjs");

const NAME = "Takt";
const blob = build(NAME);
const LENGTH = PATTERN_FIELDS.findIndex(f => f.name === "length"), BEAT_FIELD = PATTERN_FIELDS.findIndex(f => f.name === "beat");
const costs = new Map();

function boot() {
  const device = new SimDevice();
  const loaded = device.load(blob);
  assert.ok(loaded.ok, JSON.stringify(loaded.error));
  const script = device.runtime.scripts[0].script, dispatch = script.dispatch.bind(script);
  device.spent = 0;
  script.dispatch = (...a) => { const r = dispatch(...a); device.spent += r.cost; return r; };
  return device;
}

/** Runs `frames` frames; the inputs' frame numbers count from now. No fault may come, and the dearest frame of each kind is kept. */
function go(device, frames, inputs = [], where = "other") {
  const base = device.frames;
  const list = inputs.map(i => ({ ...i, frame: base + i.frame }));
  for (let n = 0; n < frames; n++) {
    device.spent = 0;
    assert.deepEqual(device.run(1, list.filter(i => i.frame === device.frames)), [], where);
    if (device.spent > (costs.get(where) ?? -1)) costs.set(where, device.spent);
  }
}

// where the app draws
const BAR = [6, 11], BEAT = [46, 11], DIGIT = [26, 40];
const SEGMENTS = [[13, 2], [23, 10], [23, 30], [13, 37], [2, 30], [2, 10], [13, 19]];   // top, right top, right bottom, bottom, left bottom, left top, middle
const READS = { 0x3F: 0, 0x06: 1, 0x5B: 2, 0x4F: 3, 0x66: 4, 0x6D: 5, 0x7D: 6, 0x07: 7, 0x7F: 8, 0x6F: 9 };
/** The digit an eye reads at [x, y], undefined when it is none. */
const digit = (d, [x, y]) => READS[SEGMENTS.reduce((m, [dx, dy], i) => m | (d.shown[((y + dy) >> 3) * 128 + x + dx] >> ((y + dy) & 7) & 1) << i, 0)];
const lit = (d, x, y) => (d.shown[(y >> 3) * 128 + x] >> (y & 7)) & 1;
/** True when the box shows exactly this text at its left edge and nothing else. */
function reads(d, text, x, y, width) {
  const want = new Display();
  want.text(text, x, y);
  for (let yy = y; yy < y + 8; yy++) for (let xx = x; xx < x + width; xx++) if (lit(d, xx, yy) !== want.get(xx, yy)) return false;
  return true;
}
const now = d => `${digit(d, BAR)}.${digit(d, BEAT)}`;

{
  const d = boot(), hw = d.hardware;
  hw.setPatternValue(LENGTH, 2);
  assert.deepEqual(d.apps.map(a => [a.name, a.group]), [["TAKT-ZAEHLER", "TOOLS"]], "the app stands under TOOLS in the BLECH menu");
  assert.ok(d.apps[0].name.length <= SCRIPT_APPS.nameLength);
  assert.equal(d.menus.length, 0, "the app has no menu page");

  // closed, it costs nothing and draws nothing, playing or not
  go(d, 120, [press(0, "PLAY"), press(100, "STOP")], "closed");
  assert.equal(costs.get("closed"), 0, "a closed app costs nothing while no key is let go");
  assert.ok(d.shown.every(b => b === 0));

  // opened while stopped: bar 1, beat 1, large, with what they are and how many bars the pattern has
  assert.ok(d.openApp(d.apps[0].id));
  go(d, 3, [], "opening");
  assert.equal(now(d), "1.1");
  assert.ok(lit(d, BAR[0] + 23, BAR[1]) && lit(d, BAR[0] + 23, BAR[1] + DIGIT[1] - 1), "a digit is 40 of the 64 pixels high");
  assert.ok(reads(d, "TAKT", 6, 1, 30) && reads(d, "SCHLAG", 46, 1, 40), "the digits are named");
  assert.ok(reads(d, "VON 2", 88, 1, 36), "the length of the pattern stands beside them");
  assert.ok(reads(d, "", 0, 55, 128), "no pattern waits: the bottom line is empty");
  go(d, 50, [], "open, nothing moves");
  assert.ok(costs.get("open, nothing moves") <= 50, `a frame in which nothing moved only looks at the step and the waiting pattern: ${costs.get("open, nothing moves")}`);

  // every key but EXIT still reaches the firmware, so the device plays on under the counter
  for (const k of KEY_NAMES) if (k.value < 34) assert.equal(hw.keyPass[k.value], k.name === "EXIT" ? 0 : 1, `${k.name} reaches the firmware`);

  // playing: every step shows its bar and its beat
  const seen = new Set();
  go(d, 1, [press(0, "PLAY")]);
  for (let n = 0; n < 400; n++) {
    go(d, 1, [], "open, playing");
    const s = hw.steps[0];
    assert.equal(now(d), `${(s >> 4) + 1}.${((s & 15) >> 2) + 1}`, `step ${s}`);
    seen.add(now(d));
  }
  assert.deepEqual([...seen].sort(), ["1.1", "1.2", "1.3", "1.4", "2.1", "2.2", "2.3", "2.4"], "two bars of four beats went by");

  // a pattern waits for the end of the sequence: its number and the beats that are left, down to 1 in the last beat
  hw.next = 11;
  const lefts = new Set();
  for (let n = 0; n < 400; n++) {
    go(d, 1, [], "open, playing, a pattern waits");
    const left = ((31 - hw.steps[0]) >> 2) + 1;
    assert.ok(reads(d, "NEXT", 4, 55, 30) && reads(d, "12", 34, 55, 24) && reads(d, "IN", 58, 55, 18), "NEXT 12 IN");
    assert.ok(reads(d, String(left), 76, 55, 52), `${left} beats are left at step ${hw.steps[0]}`);
    lefts.add(left);
  }
  assert.deepEqual([...lefts].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8], "the countdown runs from 8 to 1 over the two bars");

  // the change comes: the line goes away, the counter follows the new pattern (4 bars)
  hw.next = -1; hw.pattern = 11; hw.steps.fill(0); hw.setPatternValue(LENGTH, 4);
  go(d, 2, [{ frame: 0, event: "patternChange", args: [11] }], "open, playing");
  assert.ok(reads(d, "", 0, 55, 128), "after the change the bottom line is empty again");
  assert.ok(reads(d, "VON 4", 88, 1, 36), "the new length shows");
  const bars = new Set();
  for (let n = 0; n < 500; n++) { go(d, 1, [], "open, playing"); bars.add(digit(d, BAR)); }
  assert.deepEqual([...bars].sort(), [1, 2, 3, 4], "all four bars are counted");

  // stopped: back to 1.1
  go(d, 3, [press(0, "STOP")]);
  assert.equal(now(d), "1.1");

  // the other beats of the pattern: how many steps make a beat, and the triplet beats play 12 of the 16 steps of a bar
  hw.next = 0;
  const at = step => { hw.steps.fill(step); go(d, 2, [], "open, playing, a pattern waits"); return `${now(d)} IN ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 32].find(n => reads(d, String(n), 76, 55, 52))}`; };
  hw.setPatternValue(LENGTH, 2);
  hw.setPatternValue(BEAT_FIELD, 2);   // 8 Tri: three steps a beat
  assert.deepEqual([0, 2, 3, 11, 16, 27].map(at), ["1.1 IN 8", "1.1 IN 8", "1.2 IN 7", "1.4 IN 5", "2.1 IN 4", "2.4 IN 1"], "8 Tri");
  hw.setPatternValue(BEAT_FIELD, 1);   // 32: eight steps a beat, two beats to a group of 16
  assert.deepEqual([0, 7, 8, 16, 31].map(at), ["1.1 IN 4", "1.1 IN 4", "1.2 IN 3", "2.1 IN 2", "2.2 IN 1"], "32");
  hw.setPatternValue(BEAT_FIELD, 3);   // 16 Tri: six steps a beat
  assert.deepEqual([0, 5, 6, 11, 16, 27].map(at), ["1.1 IN 4", "1.1 IN 4", "1.2 IN 3", "1.2 IN 3", "2.1 IN 2", "2.2 IN 1"], "16 Tri");
  hw.setPatternValue(BEAT_FIELD, 4);   // BLECHTRIBE's 8: two steps a beat, eight beats to a group
  assert.deepEqual([0, 1, 2, 15, 31].map(at), ["1.1 IN 16", "1.1 IN 16", "1.2 IN 15", "1.8 IN 9", "2.8 IN 1"], "8");
  hw.setPatternValue(BEAT_FIELD, 0); hw.next = -1; hw.setPatternValue(LENGTH, 4); hw.steps.fill(0);
  go(d, 3);

  // EXIT closes. The device reports that press to no plugin, so a combination with EXIT held (EXIT + PART MUTE, EXIT + TAP)
  // would arrive at the firmware as the plain key: until EXIT comes up those keys do not reach the firmware
  const GUARDED = ["PART_ERASE", "MFX_HOLD", "PART_MUTE", "STEP_JUMP", "MFX_SEND", "BAR_1", "BAR_2", "BAR_3", "BAR_4", "TAP"];
  go(d, 3, [press(0, "EXIT")]);
  assert.equal(d.runtime.open, null, "EXIT closes the app");
  assert.ok(d.shown.every(b => b === 0));
  for (const k of GUARDED) assert.equal(hw.keyHold[key(k)], 1, `${k} does not reach the firmware while the closing EXIT is held`);
  for (const k of ["PLAY", "STOP", "MENU", "TRIGGER", "SHIFT", "WRITE"]) assert.equal(hw.keyHold[key(k)], 0, `${k} is left alone`);
  go(d, 3, [release(0, "EXIT")]);
  for (const k of GUARDED) assert.equal(hw.keyHold[key(k)], 0, `${k} is the firmware's again once EXIT is up`);
  // closed by a menu instead (no EXIT release follows): the keys come back by themselves after 3 s
  assert.ok(d.openApp(d.apps[0].id));
  go(d, 5);
  d.closeApp();
  go(d, 70);
  assert.equal(hw.keyHold[key("PART_MUTE")], 1);
  go(d, 10);
  for (const k of GUARDED) assert.equal(hw.keyHold[key(k)], 0, `${k} comes back after 3 s`);
  go(d, 100, [press(0, "PLAY"), press(10, "TAP"), release(12, "TAP"), press(90, "STOP")], "closed");
  assert.ok(costs.get("closed") <= 10, `closed, the app only looks at a released key: ${costs.get("closed")}`);
  hw.next = 3;
  assert.ok(d.openApp(d.apps[0].id));
  go(d, 3, [], "opening");
  assert.equal(now(d), "1.1");
  assert.ok(reads(d, "TAKT", 6, 1, 30) && reads(d, "VON 4", 88, 1, 36) && reads(d, "NEXT", 4, 55, 30) && reads(d, "4", 34, 55, 24) && reads(d, "16", 76, 55, 52));
}

{
  const top = [];
  for (const line of source(NAME).split("\n")) { const m = /^\/\/ ?(.*)$/.exec(line); if (!m) break; top.push(m[1]); }
  const shown = describeSource(source(NAME)).split("\n").slice(0, -1);
  assert.deepEqual(shown, top.map(l => l.trim()), "the device shows the description line for line as it is written");
  assert.ok(shown.every(l => l.length <= DESC_TRAILER.width), "20 characters a line");
  assert.ok(shown.join(" ").includes("TOOLS") && shown.join(" ").includes("EXIT"), "the description says where the app opens and how it closes");
  assert.ok(blob.length <= ARCHIVE.maxBlock);
  // what the build does with every plugin: the probe run (it opens the app) and the .blech file
  const probed = probe(blob, [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP"), release(12, "EXIT")], { minFrames: 200 });
  assert.ok(probed.ok, JSON.stringify(probed.loadError ?? probed.faults));
  assert.ok(packBlech(markProbed(blob), source(NAME)).ok, "the .blech file packs");
  console.log(`${NAME}: all tests ok`);
  console.log(`${NAME}: block ${blob.length} of ${ARCHIVE.maxBlock} bytes`);
  console.log(`${NAME}: dearest frame of each kind, in fuel units:`);
  for (const [where, cost] of [...costs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(cost).padStart(5)}  ${where}`);
}
