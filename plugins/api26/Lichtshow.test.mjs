// Lichtshow: every page and mode, the ones it had and the three new display modes. Run from the project root:
//   DISTRICT_DIR=out/district-api26 node plugins/api26/Lichtshow.test.mjs
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, source, key, press, release, probe, fork, SimDevice } from "../../tools/plugins/sim-kit.mjs";
const { describeSource } = await import(pathToFileURL(join(fork, "src/script/archive.mjs")).href);

/** A device with the light show; `storage` keeps the pages' values over a restart. Not yet run: the boot wave comes first. */
function device(storage = null) {
  const d = new SimDevice({ storage });
  assert.ok(d.load(build("Lichtshow")).ok);
  return d;
}
const run = (d, frames, inputs = []) => assert.deepEqual(d.run(frames, inputs), [], "no fault");
/** A device whose boot wave is over (it takes 37 frames). */
const fresh = storage => { const d = device(storage); run(d, 45); return d; };
const now = (d, event, ...args) => ({ frame: d.frames, event, args });
const set = (d, label, value) => d.menuSet(d.menus.find(m => m.label === label).id, value);
/** The display light: [red, green, blue] 0 to 15 as the plugin set it, null while it is the user's own colour. */
const light = d => d.hardware.backlightLevels;
/** The lights of the next `frames` frames, one entry a frame. */
const watch = (d, frames, what = light) => Array.from({ length: frames }, () => { run(d, 1); return what(d); });
/** A list as its runs of equal entries: [[entry, how many], ...]. */
const runs = list => list.reduce((r, v) => { if (r.length && r.at(-1)[0] === v) r.at(-1)[1] += 1; else r.push([v, 1]); return r; }, []);
const differ = (a, b) => a.reduce((sum, v, i) => sum + Math.abs(v - b[i]), 0);
const memory = () => {
  const saved = new Map();
  return { load: name => saved.get(name) ?? null, save: records => records.forEach(r => saved.set(r.name, r)) };
};
const hit = (d, pad) => run(d, 1, [now(d, "pad", pad, 1, 100)]);

// --- what was there before: frame for frame the same lights -----------------------------------------------------------------
// Each story is one old mode from the boot wave on: stopped, playing, faster and darker, stopped again, off. The hash is over
// the display light, the four bottom LEDs, the hold of the LEDs, all 88 panel LEDs and the meter settings of every frame,
// taken from Lichtshow.js as it was on 2026-11-12, before STATUS, PART BLITZ and PATTERN came. A mode that is changed on
// purpose gets its new hash from GOLDEN=1 in front of the command above. Changed on purpose: DISPLAY MODE 2 and UNTEN MODE 2
// (BEAT jumps on the beat since 2026-11-13, see below).
{
  const golden = {
    "DISPLAY MODE 0": "a5cec422d8373e58", "DISPLAY MODE 1": "f5b2ddefbe308e7c", "DISPLAY MODE 2": "1c04ba2006ad8b6d", "DISPLAY MODE 3": "9867b126cfc1e1cd",
    "DISPLAY MODE 4": "c104729abd7585dd", "DISPLAY MODE 5": "e4ec48ec0b5b4271", "UNTEN MODE 0": "70fc04b8cb42ab45", "UNTEN MODE 1": "57016f90d4be846c",
    "UNTEN MODE 2": "f9353cc1a79820e1", "UNTEN MODE 3": "ea1ba09abe1ae6ea", "UNTEN MODE 4": "a63940a091642644", "UNTEN MODE 5": "ef9d83f13a7b2a8d",
    "PARTY MODE 0": "70fc04b8cb42ab45", "PARTY MODE 1": "43cc1fa4ab8e33e2", "PARTY MODE 2": "04dd1849bf38ef10", "PARTY MODE 3": "13b0e3a9c0841137",
    "PARTY MODE 4": "99fe9d52cdfe0ee7", "BOOT WAVE 0": "e97ac4985507dc59",
  };
  const seen = d => JSON.stringify([light(d), d.hardware.bottomLeds, d.hardware.ledHold, Array.from(d.leds), d.hardware.objects.slice(8, 16)]);
  const story = (label, mode, speed, storage = null) => {
    const d = device(storage), frames = [];
    const go = (n, inputs = []) => { for (let i = 0; i < n; i++) { run(d, 1, inputs.filter(x => x.frame === d.frames)); frames.push(seen(d)); } };
    go(45);
    set(d, label, mode); go(120);
    go(150, [press(d.frames, "PLAY")]);
    set(d, speed, 9); set(d, "HELL", 6); go(100);
    go(60, [press(d.frames, "STOP")]);
    set(d, label, 0); go(5);
    return createHash("sha256").update(frames.join("\n")).digest("hex").slice(0, 16);
  };
  const hashes = {};
  for (const [label, speed, last] of [["DISPLAY MODE", "DISPLAY SPEED", 5], ["UNTEN MODE", "UNTEN SPEED", 5], ["PARTY MODE", "PARTY SPEED", 4]])
    for (let mode = 0; mode <= last; mode++) hashes[`${label} ${mode}`] = story(label, mode, speed);
  const noWave = memory();
  noWave.save([{ name: "Lichtshow", mask: 1 << 5, values: Int32Array.from({ length: 16 }, () => 0) }]);
  hashes["BOOT WAVE 0"] = story("DISPLAY MODE", 1, "DISPLAY SPEED", noWave);
  if (process.env.GOLDEN) { console.log(JSON.stringify(hashes, null, 2)); process.exit(0); }
  assert.deepEqual(hashes, golden, "an old mode shows other lights than before");
}

// --- BEAT: a hard jump of colour on the beat, no glide ---------------------------------------------------------------
// The user saw BEAT do nothing on the device (2026-11-13): the old BEAT glided 8 frames to the next colour, which at Hardtekk
// tempo never rests and looks like FADE, and stopped it was FADE. Now: playing, the colour holds between beats and jumps on
// each beat to the next of six; stopped, it jumps by SPEED. Every change is a jump, never a small step.
{
  for (const [page, speedPage, what, big] of [
    ["DISPLAY MODE", "DISPLAY SPEED", d => String(light(d)), (a, b) => differ(a.split(",").map(Number), b.split(",").map(Number)) >= 15],
    ["UNTEN MODE", "UNTEN SPEED", d => JSON.stringify(d.hardware.bottomLeds), (a, b) => differ(JSON.parse(a)[0], JSON.parse(b)[0]) >= 255],
  ]) {
    const d = fresh();
    set(d, page, 2); set(d, speedPage, 3); run(d, 2);
    d.hardware.tempo = 1600;
    run(d, 1, [now(d, "buttonPress", key("PLAY"))]);
    run(d, 15);
    const playing = watch(d, 75, what);
    const changes = playing.slice(1).filter((v, i) => v !== playing[i]).length;
    assert.ok(changes >= 7 && changes <= 9, `${page} BEAT at 160 BPM: ${changes} changes in 3 s, one a beat (8)`);
    for (let i = 1; i < playing.length; i++) if (playing[i] !== playing[i - 1]) assert.ok(big(playing[i - 1], playing[i]), `${page} BEAT jumps, it does not glide: ${playing[i - 1]} -> ${playing[i]}`);
    assert.ok(runs(playing).slice(1, -1).every(([, n]) => n >= 8), `${page} BEAT holds its colour between beats`);
    if (page === "UNTEN MODE") assert.ok(playing.every(v => JSON.parse(v).every(led => JSON.stringify(led) === JSON.stringify(JSON.parse(v)[0]))), "all four LEDs alike");
    run(d, 1, [now(d, "buttonPress", key("STOP"))]);
    run(d, 2);
    const stopped = watch(d, 80, what);
    const still = stopped.slice(1).filter((v, i) => v !== stopped[i]).length;
    assert.ok(still >= 3 && still <= 5, `${page} BEAT stopped at SPEED 3: a jump every 20 frames, ${still} in 80`);
    for (let i = 1; i < stopped.length; i++) if (stopped[i] !== stopped[i - 1]) assert.ok(big(stopped[i - 1], stopped[i]), `${page} BEAT stopped jumps too`);
  }
}

// --- the pages ----------------------------------------------------------------------------------------------------------
// build-district.mjs turns DISPLAY MODE, UNTEN MODE and PARTY MODE by their numbers 0, 3 and 5: the order must stay
assert.deepEqual(device().menus.map(m => [m.label, m.min, m.max, m.value]), [
  ["DISPLAY MODE", 0, 8, 1], ["DISPLAY SPEED", 1, 10, 3], ["HELL", 1, 15, 15], ["UNTEN MODE", 0, 5, 0],
  ["UNTEN SPEED", 1, 10, 3], ["PARTY MODE", 0, 4, 0], ["PARTY SPEED", 1, 10, 5], ["BOOT WAVE", 0, 1, 1],
]);

// --- what was there before, in words ----------------------------------------------------------------------------------------
{
  const d = device(), hw = d.hardware, pads = new Set();
  for (let f = 0; f < 35; f++) {
    run(d, 1);
    assert.equal(hw.ledHold, 1, "BOOT WAVE holds the LEDs");
    for (let p = 0; p < 16; p++) if (d.leds[44 + 2 * p] === 255) pads.add(p);
  }
  assert.equal(pads.size, 16, "and runs over all 16 pads");
  run(d, 1);
  assert.equal(hw.ledHold, 0, "after 36 frames (1.4 s) the LEDs are the firmware's again");
  assert.ok(light(d), "and the display light is the display mode's (FADE as it comes)");
}
{
  const d = fresh(), hw = d.hardware;
  set(d, "DISPLAY MODE", 3); run(d, 2);
  assert.deepEqual(light(d), [0, 15, 0], "GRUEN is green");
  set(d, "HELL", 7); run(d, 2);
  assert.deepEqual(light(d), [0, 7, 0], "HELL dims it");
  set(d, "DISPLAY MODE", 0); run(d, 2);
  assert.equal(light(d), null, "AUS gives the light back");

  set(d, "DISPLAY MODE", 1); set(d, "HELL", 15); set(d, "DISPLAY SPEED", 1);
  const slow = new Set(watch(d, 200).map(String)).size;
  set(d, "DISPLAY SPEED", 10);
  const fast = new Set(watch(d, 200).map(String)).size;
  assert.ok(slow > 3 && fast > 4 * slow, `FADE goes through the colours, faster with DISPLAY SPEED (${slow} and ${fast} colours in 8 s)`);

  set(d, "DISPLAY MODE", 5);
  run(d, 1, [press(d.frames, "PLAY")]);
  const beats = watch(d, 100, x => [x.hardware.steps[0] % 4 === 0, String(light(x))]);
  assert.ok(beats.some(([beat, l]) => l === "15,15,15"), "STROBE flashes white");
  assert.ok(beats.every(([beat, l], i) => l !== "15,15,15" || beat || beats[i - 1][0]), "on the beat while the sequencer runs");
  run(d, 1, [press(d.frames, "STOP")]);
  set(d, "DISPLAY MODE", 0); run(d, 2);

  for (const mode of [1, 2, 3]) {
    set(d, "UNTEN MODE", mode); run(d, 5);
    assert.ok(hw.bottomLeds.every(l => String(l) === String(hw.bottomLeds[0])), `UNTEN MODE ${mode}: all four bottom LEDs in one colour`);
  }
  set(d, "UNTEN MODE", 5);
  const bright = watch(d, 60, x => x.hardware.bottomLeds.map(l => Math.max(...l)).indexOf(255));
  assert.equal(new Set(bright).size, 4, "LAUFLICHT: the bright LED runs over all four");
  set(d, "UNTEN MODE", 4); run(d, 3);
  assert.ok(hw.bottomLeds.every(l => l === null), "METER BUNT is the firmware's meter");
  assert.deepEqual([hw.objects[8], hw.objects[12], hw.objects[15]], [0, 8, 8], "in rainbow colours");
  set(d, "UNTEN MODE", 0); run(d, 3);
  assert.deepEqual([hw.objects[8], hw.objects[12], hw.objects[15]], [0, 0, 0], "NORMAL puts the user's meter back");
  assert.ok(hw.bottomLeds.every(l => l === null), "and gives the bottom LEDs back");

  for (const mode of [1, 2, 3, 4]) {
    set(d, "PARTY MODE", mode);
    assert.ok(watch(d, 30, x => x.leds.subarray(44, 88).some(Boolean)).some(Boolean), `PARTY MODE ${mode} lights pads and bottom LEDs`);
    assert.equal(hw.ledHold, 1, "and holds all LEDs for it");
  }
  set(d, "PARTY MODE", 0); run(d, 3);
  assert.equal(hw.ledHold, 0, "party off gives the LEDs back");
  assert.equal(light(d), null, "and the display light");
}
{
  const storage = memory(), d = fresh(storage);
  for (const [label, value] of [["DISPLAY MODE", 7], ["DISPLAY SPEED", 8], ["HELL", 9], ["UNTEN MODE", 5], ["UNTEN SPEED", 2], ["PARTY MODE", 3], ["PARTY SPEED", 7], ["BOOT WAVE", 0]]) set(d, label, value);
  run(d, 5);
  const again = device(storage);
  assert.deepEqual(again.menus.map(m => m.value), [7, 8, 9, 5, 2, 0, 7, 0], "every page is kept over a restart, only PARTY MODE starts off");
  run(again, 3);
  assert.equal(again.hardware.ledHold, 0, "BOOT WAVE 0: no wave at the start");
}

// --- DISPLAY MODE 6, STATUS ------------------------------------------------------------------------------------------------
{
  const d = fresh(), hw = d.hardware;
  set(d, "DISPLAY MODE", 6); run(d, 2);
  assert.equal(light(d), null, "nothing going on: the user's own colour, also right after FADE");
  hw.unsaved = 1; run(d, 2);
  assert.deepEqual(light(d), [15, 5, 0], "an unsaved pattern: orange");
  hw.transport = 3; run(d, 2);
  assert.deepEqual(light(d), [15, 0, 0], "REC ready: red, also when the pattern is unsaved");
  hw.transport = 4; run(d, 2);
  assert.deepEqual(light(d), [15, 0, 0], "recording: red");
  set(d, "HELL", 6); run(d, 2);
  assert.deepEqual(light(d), [6, 0, 0], "HELL dims the red");
  hw.transport = 1; run(d, 2);
  assert.deepEqual(light(d), [6, 2, 0], "and the orange");
  set(d, "HELL", 1); run(d, 2);
  assert.notDeepEqual(light(d), [1, 0, 0], "orange is not red even at the darkest");
  set(d, "HELL", 15);
  hw.unsaved = 0; run(d, 2);
  assert.equal(light(d), null, "saved: the user's own colour again");

  // a pattern change waits for the end of the sequence: the light blinks dark, in the colour of the state
  hw.next = 7;
  const blink = runs(watch(d, 90).map(String));
  assert.deepEqual(blink.slice(0, 4), [["0,0,0", 9], ["null", 9], ["0,0,0", 9], ["null", 9]], "a waiting pattern change blinks: dark at once, 9 frames dark and 9 in the user's colour at DISPLAY SPEED 3");
  set(d, "DISPLAY SPEED", 10);
  assert.ok(runs(watch(d, 40).map(String)).slice(1, -1).every(([, n]) => n === 2), "DISPLAY SPEED 10 blinks every 2 frames");
  hw.unsaved = 1;
  assert.deepEqual([...new Set(watch(d, 20).map(String))].sort(), ["0,0,0", "15,5,0"], "unsaved and waiting: orange blinks");
  hw.transport = 4;
  assert.deepEqual([...new Set(watch(d, 20).map(String))].sort(), ["0,0,0", "15,0,0"], "recording and waiting: red blinks");
  hw.next = -1; run(d, 2);
  assert.deepEqual(new Set(watch(d, 20).map(String)), new Set(["15,0,0"]), "the change is done: steady again");
  for (const frames of [1, 2, 3, 4]) {
    hw.next = 8; run(d, 1);
    assert.deepEqual(light(d), [0, 0, 0], "every waiting change goes dark at once, wherever the last blink stopped");
    run(d, frames);
    hw.next = -1; run(d, 2);
  }

  // another mode and back, party and back, off
  hw.transport = 0; hw.unsaved = 0; run(d, 2);
  set(d, "DISPLAY MODE", 3); run(d, 2);
  set(d, "DISPLAY MODE", 6); run(d, 2);
  assert.equal(light(d), null, "back from GRUEN with nothing going on: the green is gone");
  hw.transport = 4; run(d, 2);
  set(d, "PARTY MODE", 2); run(d, 20);
  set(d, "PARTY MODE", 0); run(d, 2);
  assert.deepEqual(light(d), [15, 0, 0], "after the party the state shows again");
  set(d, "DISPLAY MODE", 0); run(d, 2);
  assert.equal(light(d), null, "AUS gives the light back");
}
{
  const storage = memory();
  const before = fresh(storage);
  set(before, "DISPLAY MODE", 6); run(before, 5);
  const d = device(storage);
  d.hardware.unsaved = 1;
  run(d, 45);
  assert.deepEqual(light(d), [15, 5, 0], "STATUS shows right after the boot wave");
  d.hardware.unsaved = 0; run(d, 2);
  assert.equal(light(d), null);
  // the boot wave leaves its last colour on the light: each of the three modes takes over from it
  const after = mode => { set(before, "DISPLAY MODE", mode); run(before, 5); return light(fresh(storage)); };
  assert.equal(after(6), null, "STATUS with nothing going on: the user's colour after the boot wave");
  assert.equal(after(7), null, "PART BLITZ: the user's colour after the boot wave");
  assert.deepEqual(after(8), [15, 0, 0], "PATTERN: the pattern's colour after the boot wave");
}

// --- DISPLAY MODE 7, PART BLITZ ----------------------------------------------------------------------------------------------
{
  // the 16 colours, from the pads in the TRIGGER mode
  const d = fresh();
  set(d, "DISPLAY MODE", 7); run(d, 2);
  assert.equal(light(d), null, "nothing strikes: the user's own colour, also right after FADE");
  const colours = [];
  for (let part = 0; part < 16; part++) { hit(d, part); colours.push(light(d)); run(d, 8); assert.equal(light(d), null, "and back"); }
  assert.ok(colours.every(Boolean), "a pad struck in TRIGGER mode flashes");
  assert.deepEqual(colours[0], [15, 0, 0], "part 1 is red");
  assert.equal(new Set(colours.map(String)).size, 16, "16 parts, 16 colours");
  assert.ok(colours.every((c, i) => differ(c, colours[(i + 1) % 16]) >= 20), "neighbours are far apart on the colour wheel");
  hit(d, 3);
  assert.deepEqual(light(d), colours[3], "a part keeps its colour");
  run(d, 1, [now(d, "pad", 3, 0, 0)]);
  run(d, 8);
  assert.equal(light(d), null);
  run(d, 1, [now(d, "pad", 3, 0, 0)]);
  assert.equal(light(d), null, "letting a pad go does not flash");

  // nothing left over from another mode
  set(d, "DISPLAY MODE", 3); hit(d, 5);
  set(d, "DISPLAY MODE", 7); run(d, 1);
  assert.equal(light(d), null, "a pad hit before PART BLITZ was chosen does not flash afterwards");
  run(d, 1, [now(d, "pad", 5, 1, 100)]);
  set(d, "DISPLAY MODE", 3); run(d, 1);
  set(d, "DISPLAY MODE", 7); run(d, 1);
  assert.equal(light(d), null, "back from GRUEN in the middle of a flash: the green is gone at once");

  // how long: DISPLAY SPEED
  const lit = () => { hit(d, 0); return 1 + watch(d, 12).filter(Boolean).length; };
  assert.equal(lit(), 4, "4 frames (160 ms) at DISPLAY SPEED 3");
  set(d, "DISPLAY SPEED", 10);
  assert.equal(lit(), 1, "1 frame at 10");
  set(d, "DISPLAY SPEED", 1);
  assert.equal(lit(), 5, "5 frames at 1");
  set(d, "DISPLAY SPEED", 3);
  set(d, "HELL", 5);
  hit(d, 0);
  assert.deepEqual(light(d), [5, 0, 0], "HELL dims the flash");
  set(d, "HELL", 15); run(d, 8);

  // the other pad modes: in KEYBOARD and CHORD a pad plays the selected part, in SEQUENCER, STEP JUMP and PATTERN SET none
  d.hardware.part = 9;
  for (const mode of ["KEYBOARD", "CHORD"]) {
    run(d, 1, [press(d.frames, "TRIGGER")]);
    run(d, 1, [press(d.frames, mode)]); hit(d, 2);
    assert.deepEqual(light(d), colours[9], `${mode}: the colour of the selected part`);
    run(d, 8);
  }
  d.hardware.part = 16;
  hit(d, 2);
  assert.equal(light(d), null, "all parts selected: no part, no flash");
  for (const mode of ["SEQUENCER", "STEP_JUMP", "PATTERN_SET"]) {
    run(d, 1, [press(d.frames, "TRIGGER")]);
    run(d, 1, [press(d.frames, mode)]); hit(d, 2);
    assert.equal(light(d), null, `${mode}: a pad plays no part and does not flash`);
  }
  run(d, 1, [press(d.frames, "TRIGGER")]); hit(d, 2);
  assert.deepEqual(light(d), colours[2], "TRIGGER again: the pad's own part");
  run(d, 8);

  // the sequencer: the part whose step strikes
  const hw = d.hardware;
  hw.setStep(2, 4, 60, 100);
  run(d, 1, [press(d.frames, "PLAY")]);
  const bar = watch(d, 50, x => [x.hardware.steps[0], light(x)]);
  const first = bar.findIndex(([step]) => step === 4);
  assert.ok(bar.slice(0, first).every(([, l]) => l === null), "no step, no flash");
  assert.deepEqual(bar[first][1], colours[2], "part 3 strikes on step 5: its colour in that very frame");
  assert.deepEqual(bar.slice(first, first + 6).map(([, l]) => Boolean(l)), [true, true, true, true, false, false], "then back to the user's colour");
  hw.setStep(5, 4, 60, 100);
  assert.deepEqual(watch(d, 50).find(Boolean), colours[2], "two parts on one step: the lower part's colour");
  hw.mutes[2] = 1;
  assert.deepEqual(watch(d, 50).find(Boolean), colours[5], "a muted part does not flash, the next one does");
  hw.mutes[5] = 1;
  assert.equal(watch(d, 50).find(Boolean), undefined, "all muted: dark");
  hw.setStep(15, 8, 60, 100);
  const last = watch(d, 50, x => [x.hardware.steps[0], light(x)]);
  assert.deepEqual(last.find(([step]) => step === 8)[1], colours[15], "part 16 flashes in the frame of its step too");
  hit(d, 7);
  assert.deepEqual(light(d), colours[7], "a pad flashes while the sequencer runs");
  // LAST STEP gives a part a step counter of its own: here part 10 runs 5 steps ahead of part 1
  hw.mutes[15] = 1; run(d, 8);
  hw.setStep(9, 2, 60, 100);
  const tick = hw.tick.bind(hw);
  hw.tick = ms => { tick(ms); hw.steps[9] = (hw.steps[0] + 5) % 16; };
  const own = watch(d, 60, x => [x.hardware.steps[0], light(x)]).filter(([, l]) => l);
  assert.ok(own.length && own.every(([, l]) => String(l) === String(colours[9])), "a part with its own step counter flashes");
  assert.ok(own.some(([step]) => step === 13) && !own.some(([step]) => step === 2), "on its own step 3, when part 1 is at step 14");
  hw.tick = tick; hw.mutes[15] = 0; hw.mutes[9] = 1;
  // every 32nd at 300 BPM: more than one step a frame
  hw.tempo = 3000;
  for (let step = 0; step < 16; step++) hw.setStep(15, step, 60, 100);
  assert.ok(watch(d, 100).every(l => String(l) === String(colours[15])), "steps in every frame: the light stays in the part's colour");
  for (let n = 0; n < 6; n++) { hit(d, 7); assert.deepEqual(light(d), colours[7], "a pad that is hit wins over the step of the same frame"); }
  run(d, 1, [press(d.frames, "STOP")]);
  run(d, 8);
  assert.equal(light(d), null, "stopped: back");

  set(d, "PARTY MODE", 1); run(d, 20);
  set(d, "PARTY MODE", 0); run(d, 2);
  assert.equal(light(d), null, "after the party the light is the user's until a part strikes");
  hit(d, 4);
  set(d, "DISPLAY MODE", 0); run(d, 2);
  assert.equal(light(d), null, "AUS gives the light back, also in the middle of a flash");
  hit(d, 4);
  assert.equal(light(d), null, "and no pad flashes any more");
}

// --- DISPLAY MODE 8, PATTERN -------------------------------------------------------------------------------------------------
{
  const d = fresh(), hw = d.hardware;
  set(d, "DISPLAY MODE", 8);
  const colours = [];
  for (let p = 0; p < 250; p++) { hw.pattern = p; run(d, 1); colours.push(light(d)); }
  assert.ok(colours.every(Boolean), "every pattern has a colour, shown in the frame it is selected");
  assert.deepEqual(colours[0], [15, 0, 0], "pattern 1 is red");
  assert.ok(colours.slice(1).every((c, i) => differ(c, colours[i]) >= 20), "neighbours are far apart on the colour wheel");
  assert.equal(new Set(colours.map(String)).size, 90, "the whole colour wheel is used: 90 colours for the 250 patterns");
  hw.pattern = 41; run(d, 1);
  assert.deepEqual(light(d), colours[41], "a pattern keeps its colour");
  assert.deepEqual(new Set(watch(d, 100).map(String)), new Set([String(colours[41])]), "and the light stands still while it plays");
  set(d, "HELL", 5); run(d, 1);
  assert.ok(Math.max(...light(d)) === 5, "HELL dims it");
  set(d, "HELL", 15);
  set(d, "PARTY MODE", 4); run(d, 20);
  set(d, "PARTY MODE", 0); run(d, 2);
  assert.deepEqual(light(d), colours[41], "after the party the pattern's colour is back");
  set(d, "DISPLAY MODE", 0); run(d, 2);
  assert.equal(light(d), null, "AUS gives the light back");
}

// --- what tools/plugins/build-district.mjs asks of this plugin before it packs it: its own checks, here on the frozen fork --------
{
  const d = device(), hw = d.hardware;
  const faults = d.run(3);
  assert.equal(hw.ledHold, 1, "the boot wave holds the LEDs");
  faults.push(...d.run(45));
  assert.equal(hw.ledHold, 0, "and gives them back");
  for (const [name, [id, max]] of Object.entries({ dMode: [0, 5], uMode: [3, 5], pMode: [5, 4] })) for (let m = 1; m <= max; m++) {
    d.runtime.menuSet(id, m);
    faults.push(...d.run(200, [press(d.frames + 1, "PLAY")]));
    faults.push(...d.run(200, [press(d.frames + 1, "STOP")]));
    if (name === "dMode") assert.ok(hw.backlightLevels, `display mode ${m} sets the light`);
    if (name === "uMode" && m !== 4) assert.ok(hw.bottomLeds.every(Boolean), `bottom mode ${m} sets all four LEDs`);
    if (name === "uMode" && m === 4) assert.ok(hw.bottomLeds.every(l => l === null), "the rainbow meter is the firmware's");
    if (name === "pMode") assert.equal(hw.ledHold, 1, `party ${m} holds the LEDs`);
    d.runtime.menuSet(id, 0);
    faults.push(...d.run(5));
    if (name === "dMode") assert.equal(hw.backlightLevels, null, "display off gives the light back");
    if (name === "uMode") assert.ok(hw.bottomLeds.every(l => l === null), "bottom off gives the LEDs back");
  }
  assert.deepEqual(faults, []);
  assert.equal(hw.ledHold, 0, "party off gives the LEDs back");
  assert.ok(probe(build("Lichtshow"), [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP"), release(12, "EXIT")], { minFrames: 200 }).ok, "and its probe before packing");
}

// --- what a frame costs (the device gives all plugins together 5 ms a frame) ----------------------------------------------
{
  /** The dearest frame of `frames` frames after `setup`: all handlers of a frame together; `each` runs before every frame. */
  const dearest = (setup, { frames = 300, each = () => [], d = fresh() } = {}) => {
    let cost = 0, max = 0;
    const entry = d.runtime.scripts[0], dispatch = entry.script.dispatch.bind(entry.script);
    entry.script.dispatch = (...a) => { const r = dispatch(...a); cost += r.cost; return r; };
    setup(d);
    run(d, 3);
    for (let f = 0; f < frames; f++) { cost = 0; run(d, 1, each(d, f) ?? []); max = Math.max(max, cost); }
    return max;
  };
  const play = d => run(d, 1, [press(d.frames, "PLAY")]);
  /** A mode alone, stopped and playing; the other two pages off. */
  const mode = (label, value) => Math.max(...[false, true].map(playing => dearest(d => { set(d, "DISPLAY MODE", 0); set(d, label, value); if (playing) play(d); })));
  const cost = {};
  for (let m = 1; m <= 5; m++) cost[`DISPLAY ${m}`] = mode("DISPLAY MODE", m);
  cost["DISPLAY 6 STATUS"] = Math.max(
    mode("DISPLAY MODE", 6),
    // everything at once: unsaved, a change waiting and blinking as fast as it goes, REC on and off every third frame
    dearest(d => { set(d, "DISPLAY MODE", 6); set(d, "DISPLAY SPEED", 10); d.hardware.unsaved = 1; d.hardware.next = 3; }, { each: (d, f) => { d.hardware.transport = f % 3 ? 1 : 4; } }));
  const steps = (d, parts) => { for (const part of parts) for (let step = 0; step < 16; step++) d.hardware.setStep(part, step, 60, 100); };
  const all = Array.from({ length: 16 }, (_, i) => i);
  cost["DISPLAY 7 PART BLITZ, a kick on part 1"] = dearest(d => { set(d, "DISPLAY MODE", 7); for (const step of [0, 4, 8, 12]) d.hardware.setStep(0, step, 60, 100); d.hardware.tempo = 1700; play(d); });
  cost["DISPLAY 7 PART BLITZ, no part strikes"] = dearest(d => { set(d, "DISPLAY MODE", 7); d.hardware.setStep(0, 0, 60, 100); d.hardware.mutes[0] = 1; d.hardware.tempo = 3000; play(d); });
  cost["DISPLAY 7 PART BLITZ, only part 16 strikes, 300 BPM"] = dearest(d => { set(d, "DISPLAY MODE", 7); steps(d, [15]); d.hardware.tempo = 3000; play(d); });
  cost["DISPLAY 7 PART BLITZ, a pad hit and a key pressed in every frame"] = dearest(d => { set(d, "DISPLAY MODE", 7); }, { each: (d, f) => [now(d, "pad", f % 16, 1, 100), now(d, "buttonPress", key("KEYBOARD"))] });
  cost["DISPLAY 7 PART BLITZ, 16 parts strike, 15 muted"] = dearest(d => { set(d, "DISPLAY MODE", 7); steps(d, all); d.hardware.mutes.fill(1, 0, 15); d.hardware.tempo = 3000; play(d); });
  cost["DISPLAY 6 STATUS, nothing changes"] = dearest(d => { set(d, "DISPLAY MODE", 6); d.hardware.unsaved = 1; play(d); });
  cost["DISPLAY 8 PATTERN, the pattern stays"] = dearest(d => { set(d, "DISPLAY MODE", 8); play(d); });
  cost["DISPLAY 7 PART BLITZ, stopped"] = dearest(d => { set(d, "DISPLAY MODE", 7); });
  cost["DISPLAY 8 PATTERN"] = Math.max(
    mode("DISPLAY MODE", 8),
    dearest(d => { set(d, "DISPLAY MODE", 8); }, { each: (d, f) => { d.hardware.pattern = f % 250; } }));
  for (let m = 1; m <= 5; m++) cost[`UNTEN ${m}`] = mode("UNTEN MODE", m);
  for (let m = 1; m <= 4; m++) cost[`PARTY ${m}`] = mode("PARTY MODE", m);
  cost["BOOT WAVE"] = dearest(() => {}, { frames: 45, d: device() });
  cost["nothing on (DISPLAY 0, UNTEN 0, PARTY 0)"] = mode("DISPLAY MODE", 0);
  cost["a page turned"] = dearest(d => { set(d, "DISPLAY MODE", 0); }, { frames: 40, each: (d, f) => { set(d, ["DISPLAY MODE", "UNTEN MODE", "HELL", "DISPLAY SPEED"][f % 4], 1 + f % 5); } });
  cost["the dearest pair without party: DISPLAY 7 with 15 parts muted and UNTEN 5"] = dearest(d => { set(d, "DISPLAY MODE", 7); set(d, "UNTEN MODE", 5); steps(d, all); d.hardware.mutes.fill(1, 0, 15); d.hardware.tempo = 3000; play(d); });
  console.log(`Lichtshow cost a frame:\n${Object.entries(cost).map(([name, n]) => `  ${String(n).padStart(5)}  ${name}`).join("\n")}`);
  const most = prefix => Math.max(...Object.entries(cost).filter(([name]) => name.startsWith(prefix)).map(([, n]) => n));
  // ceilings a little above what was measured on 2026-11-13, so a change that makes a mode dearer is seen
  assert.ok(most("DISPLAY 6") <= 230 && most("DISPLAY 8") <= 270, "STATUS and PATTERN cost no more than FADE even in a frame where the colour changes");
  assert.ok(cost["DISPLAY 6 STATUS, nothing changes"] <= 150 && cost["DISPLAY 8 PATTERN, the pattern stays"] <= 100 && cost["DISPLAY 7 PART BLITZ, stopped"] <= 100, "and next to nothing while the light stands: it is only set when it changes");
  assert.ok(cost["DISPLAY 7 PART BLITZ, a kick on part 1"] <= 650 && most("DISPLAY 7") <= 950, "PART BLITZ looks at 16 parts on a step: about twice an old display mode");
  assert.ok(cost["DISPLAY 7 PART BLITZ, only part 16 strikes, 300 BPM"] <= 600, "a part that strikes again and again sets the light once");
  assert.ok(Math.max(...[1, 2, 3, 4, 5].map(m => cost[`DISPLAY ${m}`])) <= 330 && most("UNTEN") <= 570, "the old display and bottom modes cost what they did");
  assert.ok(most("PARTY") <= 2600 && most("BOOT") <= 850, "party and boot wave cost what they did");
}

// --- the file ---------------------------------------------------------------------------------------------------------------
{
  const text = source("Lichtshow"), block = build("Lichtshow"), d = device();
  const top = text.split("\n"), written = top.slice(0, top.findIndex(l => !l.startsWith("//"))).map(l => l.slice(2).trim());
  assert.deepEqual(describeSource(text).split("\n").slice(0, -1), written, "the device shows the description line for line as written");
  assert.ok(written.every(l => l.length <= 20 && /^[ -~]*$/.test(l)), "lines of at most 20 ASCII characters");
  assert.ok(describeSource(text).length < 2047, "the description fits the device's 2047 bytes");
  // the table of value names: in the description behind [WERTE], and in the code behind "// [WERTE]" next to the pages
  // an entry is "PAGE: 0=NAME 1=NAME ..."; in the description a paragraph, in the code a line
  const names = entries => Object.fromEntries(entries.map(entry => [entry.slice(0, entry.indexOf(": ")), entry.slice(entry.indexOf(": ") + 2).split(/ ?\d+=/).slice(1)]));
  const table = names(written.slice(written.indexOf("[WERTE]") + 2).join(" ").split("  "));
  const inCode = names(top.slice(written.length).filter(l => /^\/\/ [A-Z ]+: 0=/.test(l)).map(l => l.slice(3)));
  assert.deepEqual(table, inCode, "the code comments name the values as the description does");
  assert.deepEqual(Object.keys(table), ["DISPLAY MODE", "UNTEN MODE", "PARTY MODE", "BOOT WAVE"]);
  for (const [label, values] of Object.entries(table)) {
    const page = d.menus.find(m => m.label === label);
    assert.equal(values.length, page.max - page.min + 1, `${label}: a name for every value`);
    assert.ok(values.every(v => /^[A-Z][A-Z ]{1,14}$/.test(v)), `${label}: short upper-case names (${values})`);
  }
  assert.deepEqual(table["DISPLAY MODE"].slice(6), ["STATUS", "PART BLITZ", "PATTERN"]);
  assert.ok(block.length <= 32752);
  console.log(`Lichtshow: block ${block.length} bytes`);
}
console.log("Lichtshow: tests ok");
