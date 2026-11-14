// Tests for plugins/api26/Spielen.js in the fork's simulator: what the user would notice after each combination.
// Run from the project root: DISTRICT_DIR=out/district-api26 node plugins/api26/Spielen.test.mjs
// The simulator has no firmware behind the keys: "kept from the firmware" is read from its hold masks, a guest's encoder turn
// is played by writing the pattern value the firmware would have written, and a step "triggers" when its part is not muted at
// the moment the sequencer reaches it.
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build, SimDevice, probe, key, field, fork, press, release, source } from "../../tools/plugins/sim-kit.mjs";

const load = p => import(pathToFileURL(join(fork, p)).href);
const { OBJECTS } = await load("data/script/objects.mjs");
const { Display } = await load("src/script/display.mjs");
const { describeSource, packBlech } = await load("src/script/archive.mjs");
const { markProbed } = await load("src/script/blob.mjs");
const { PATTERN_FIELDS, ARCHIVE, DESC_TRAILER } = await load("data/script/contract.mjs");

const NAME = "Spielen";
const blob = build(NAME);
const leaf = path => OBJECTS.find(o => o.path === path).id;
const PCL = leaf("korg.global.patternChangeLock"), TEMPO_LOCK = leaf("korg.global.tempoLock");
const LENGTH = PATTERN_FIELDS.findIndex(f => f.name === "length"), BEAT = PATTERN_FIELDS.findIndex(f => f.name === "beat");
const SAMPLE = field("sample"), CUTOFF = field("cutoff"), IFX_TYPE = field("ifxType"), IFX_EDIT = field("ifxEdit");
const costs = new Map();   // the dearest frame of each kind, in fuel units
const dearest = () => Math.max(...costs.values());

/** A device with the plugin loaded; `spent` adds up what its handlers cost. `storage` is the card, kept over a restart. */
function boot(storage = null) {
  const device = new SimDevice({ storage });
  const loaded = device.load(blob);
  assert.ok(loaded.ok, JSON.stringify(loaded.error));
  const script = device.runtime.scripts[0].script, dispatch = script.dispatch.bind(script);
  device.spent = 0;
  script.dispatch = (...a) => { const r = dispatch(...a); device.spent += r.cost; return r; };
  return device;
}

/** Runs `frames` frames; the inputs' frame numbers count from now. No fault may come, and the dearest frame is remembered. */
function go(device, frames, inputs = [], where = "other") {
  const base = device.frames;
  const list = inputs.map(i => ({ ...i, frame: base + i.frame }));
  for (let n = 0; n < frames; n++) {
    device.spent = 0;
    assert.deepEqual(device.run(1, list.filter(i => i.frame === device.frames)), [], where);
    if (device.spent > (costs.get(where) ?? -1)) costs.set(where, device.spent);
  }
}

/** The card: what korg.store.save wrote, by plugin name. */
function card() {
  const saved = new Map();
  return { load: name => saved.get(name) ?? null, save: records => { for (const r of records) saved.set(r.name, { mask: r.mask, values: Array.from(r.values) }); } };
}

/** True while the plugin shows these two lines (the second may be missing) on the display. */
function says(device, line1, line2 = "") {
  if (!device.runtime.open) return false;
  const want = new Display();
  want.text(line1, 4, 16);
  if (line2) want.text(line2, 4, 32);
  return want.bytes.every((b, i) => (device.display.bytes[i] & b) === b);
}

const fill = (hw, from, to, frames = 12000, rate = 48000) => { for (let i = from; i <= to; i++) hw.samples.set(i, { frames, rate, tune: 0 }); };
const sampleOf = (hw, part) => hw.patternValue(-1, part, SAMPLE);
const event = (frame, name, ...args) => ({ frame, event: name, args });
const tap = (first, k) => [press(0, "EXIT"), press(1, first), release(2, first), release(3, "EXIT")].map(i => ({ ...i, frame: i.frame + (k ?? 0) }));
const mutes = hw => Array.from(hw.mutes).join("");
const setMutes = (hw, text) => { for (let p = 0; p < 16; p++) hw.mutes[p] = Number(text[p]); };

// ---------------------------------------------------------------------------------------------------------------- roulette
{
  const roll = (d, frames = 4) => go(d, frames, tap("PART_ERASE"), "roulette");

  // a kick (slot 21, index 20) becomes another kick: slots 19 to 55, never the same one, never an empty slot
  let d = boot(), hw = d.hardware;
  fill(hw, 18, 54); fill(hw, 55, 98); fill(hw, 500, 520);
  for (const empty of [22, 23, 30, 31, 32, 54]) hw.samples.delete(empty);
  hw.setPartValue(0, SAMPLE, 20);
  const seen = new Set();
  for (let n = 0; n < 40; n++) {
    const before = sampleOf(hw, 0);
    roll(d);
    const now = sampleOf(hw, 0);
    assert.ok(now >= 18 && now <= 54, `a kick stays a kick, got index ${now}`);
    assert.notEqual(now, before, "the sample changes every time");
    assert.ok(hw.samples.has(now), `index ${now} is an empty slot`);
    seen.add(now);
  }
  assert.ok(seen.size >= 8, `40 turns give many different kicks, got ${seen.size}`);
  assert.equal(hw.quickSaves, 0, "roulette does not save by itself");

  // the borders of the factory categories: a snare (slots 56 to 99) stays a snare, the last PCM slot (421) stays in 391 to 421
  hw.setPartValue(1, SAMPLE, 55); hw.part = 1;
  for (let n = 0; n < 20; n++) { roll(d); const now = sampleOf(hw, 1); assert.ok(now >= 55 && now <= 98, `snare, got ${now}`); }
  fill(hw, 390, 420);
  hw.setPartValue(2, SAMPLE, 420); hw.part = 2;
  for (let n = 0; n < 20; n++) { roll(d); const now = sampleOf(hw, 2); assert.ok(now >= 390 && now <= 420, `PCM, got ${now}`); }

  // while EXIT is down PART ERASE stays away from the firmware (no PART ERASE mode), afterwards it is the firmware's again
  go(d, 2, [press(0, "EXIT")]);
  assert.equal(hw.keyHold[key("PART_ERASE")], 1, "EXIT held keeps PART ERASE from the firmware");
  go(d, 2, [release(0, "EXIT")]);
  assert.equal(hw.keyHold[key("PART_ERASE")], 0, "EXIT let go gives PART ERASE back");

  // EXIT held for a long time while PART ERASE is tapped again and again: every tap turns, none reaches the firmware
  hw.part = 0;
  go(d, 2, [press(0, "EXIT")]);
  for (let n = 0; n < 6; n++) {
    const was = sampleOf(hw, 0);
    go(d, 50, [press(45, "PART_ERASE"), release(47, "PART_ERASE")], "roulette");
    assert.notEqual(sampleOf(hw, 0), was, `tap ${n + 1} after ${2 * (n + 1)} s of EXIT still turns`);
    assert.equal(hw.keyHold[key("PART_ERASE")], 1);
  }
  go(d, 2, [release(0, "EXIT")]);

  // PART ERASE alone, and SHIFT + PART ERASE (the melody generator's) with EXIT, change nothing
  hw.part = 0;
  let before = sampleOf(hw, 0);
  go(d, 4, [press(0, "PART_ERASE"), release(1, "PART_ERASE")]);
  go(d, 6, [press(0, "EXIT"), press(1, "SHIFT"), press(2, "PART_ERASE"), release(3, "PART_ERASE"), release(4, "SHIFT"), release(5, "EXIT")]);
  assert.equal(sampleOf(hw, 0), before, "only EXIT + PART ERASE turns the roulette");

  // an empty category: the only sample of its range stays, and the display says so once EXIT is let go
  d = boot(); hw = d.hardware;
  hw.samples.set(100, { frames: 9000, rate: 48000, tune: 0 }); fill(hw, 18, 54);
  hw.setPartValue(0, SAMPLE, 100);
  go(d, 3, tap("PART_ERASE").slice(0, 3), "roulette");
  assert.equal(d.runtime.open, null, "no text while EXIT is held, its release would get lost on the device");
  go(d, 2, [release(0, "EXIT")]);
  assert.equal(sampleOf(hw, 0), 100, "nothing else in the category: the sample stays");
  assert.ok(says(d, "ROULETTE:", "KEIN ANDERES SAMPLE"), "the display says why");
  go(d, 30);
  assert.equal(d.runtime.open, null, "the text goes away by itself");

  // user samples (slots 501 to 999): short ones only against short ones, long ones (3 s and more) against long ones
  d = boot(); hw = d.hardware;
  hw.samples.set(510, { frames: 24000, rate: 48000, tune: 0 });   // 0.5 s
  hw.samples.set(520, { frames: 48000, rate: 48000, tune: 0 });   // 1 s
  hw.samples.set(530, { frames: 480000, rate: 48000, tune: 0 });  // 10 s
  hw.samples.set(600, { frames: 150000, rate: 32000, tune: 0 });  // 4.7 s
  hw.setPartValue(0, SAMPLE, 510);
  for (let n = 0; n < 6; n++) { roll(d, 40); assert.ok([510, 520].includes(sampleOf(hw, 0)), `short stays short, got ${sampleOf(hw, 0)}`); }
  hw.setPartValue(0, SAMPLE, 530);
  roll(d, 40);
  assert.equal(sampleOf(hw, 0), 600, "a long sample becomes the other long one");

  // a nearly empty range is searched over several frames, never much in one, and still finds the one other sample
  d = boot(); hw = d.hardware;
  hw.samples.set(500, { frames: 24000, rate: 48000, tune: 0 });
  hw.samples.set(998, { frames: 24000, rate: 48000, tune: 0 });
  hw.setPartValue(0, SAMPLE, 500);
  go(d, 45, tap("PART_ERASE"), "roulette, long search");
  assert.equal(sampleOf(hw, 0), 998, "the one other user sample is found");
  assert.ok(costs.get("roulette, long search") < 2000, `the search costs at most a small piece per frame, got ${costs.get("roulette, long search")}`);

  // a pattern change in the middle of such a search ends it: the new pattern's sample stays
  hw.setPartValue(0, SAMPLE, 500);
  go(d, 6, tap("PART_ERASE"), "roulette");
  hw.setPartValue(0, SAMPLE, 500);   // the new pattern has the same sample on the part
  go(d, 45, [event(0, "patternChange", 2)]);
  if (sampleOf(hw, 0) === 998) {   // the search had found it within those 6 frames already: once more, from the other side
    go(d, 6, tap("PART_ERASE"));
    hw.setPartValue(0, SAMPLE, 998);
    go(d, 45, [event(0, "patternChange", 3)]);
    assert.equal(sampleOf(hw, 0), 998, "a search does not go on into the next pattern");
  } else assert.equal(sampleOf(hw, 0), 500, "a search does not go on into the next pattern");
  assert.equal(d.runtime.open, null, "and says nothing");

  // the device writes no slot the SAMPLE knob would skip: then the display says that the slot was refused
  d = boot(); hw = d.hardware;
  fill(hw, 18, 54); hw.setPartValue(0, SAMPLE, 20);
  hw.setPartValue = () => {};
  go(d, 6, tap("PART_ERASE"));
  assert.equal(sampleOf(hw, 0), 20);
  assert.ok(says(d, "ROULETTE:", "SLOT ABGELEHNT"), "a refused slot is told");

  // the built-in waveforms (slots 1 to 16) turn among themselves, Audio In (17, 18) and the range 422 to 500 stay
  d = boot(); hw = d.hardware;
  hw.setPartValue(0, SAMPLE, 3);
  for (let n = 0; n < 20; n++) { const was = sampleOf(hw, 0); roll(d); const now = sampleOf(hw, 0); assert.ok(now >= 0 && now <= 15 && now !== was, `waveform, got ${now}`); }
  hw.setPartValue(0, SAMPLE, 16); roll(d); assert.equal(sampleOf(hw, 0), 16, "Audio In stays");
  go(d, 30);
  hw.setPartValue(0, SAMPLE, 430); roll(d, 30); assert.equal(sampleOf(hw, 0), 430, "slots 422 to 500 stay");

  // no single part selected, or a sample number that is no slot: nothing changes and nothing breaks
  hw.setPartValue(0, SAMPLE, 3); hw.part = 16;
  roll(d);
  assert.equal(sampleOf(hw, 0), 3);
  hw.part = 0; hw.patternBlock(-1).set([0xFF, 0xFF], 0x800 + 8);
  roll(d);
  assert.equal(sampleOf(hw, 0), 65535);
  console.log("roulette ok");
}

// -------------------------------------------------------------------------------------------------------------- party lock
{
  const HOLD = [press(0, "EXIT"), press(1, "MFX_HOLD"), release(30, "MFX_HOLD"), release(31, "EXIT")];
  const lock = d => go(d, 34, HOLD, "lock");
  const LOCKED = ["REC", "TAP", "GATE_ARP", "TOUCH_SCALE", "MASTER_FX", "MFX_HOLD", "EDIT_LEFT", "MENU", "SHIFT", "PART_LEFT", "EDIT_RIGHT", "WRITE",
    "PART_RIGHT", "PART_MUTE", "PART_ERASE", "LPF", "TRIGGER", "HPF", "SEQUENCER", "BPF", "KEYBOARD", "CHORD", "STEP_JUMP", "MFX_SEND", "PATTERN_SET",
    "BAR_1", "BAR_2", "BAR_3", "BAR_4", "AMP_EG", "IFX_ON"];

  // pressed too briefly (0.8 s), or EXIT let go first: no lock
  let d = boot(), hw = d.hardware;
  go(d, 40, [press(0, "EXIT"), press(1, "MFX_HOLD"), release(21, "MFX_HOLD"), release(22, "EXIT")]);
  assert.equal(hw.knobHold, 0, "0.8 s is too brief");
  go(d, 60, [press(0, "EXIT"), press(1, "MFX_HOLD"), release(10, "EXIT"), release(45, "MFX_HOLD")]);
  assert.equal(hw.knobHold, 0, "EXIT let go first: no lock");
  go(d, 40, [press(0, "EXIT"), press(1, "MFX_HOLD"), release(26, "MFX_HOLD"), release(27, "EXIT")]);
  assert.equal(hw.knobHold, 0, "let go in the very frame the second is over: no lock");
  assert.equal(hw.keyHold[key("MENU")], 0);
  assert.equal(hw.objects[PCL], 0);

  // EXIT + MFX HOLD for a second locks: knobs and every key but PLAY and STOP stay away from the firmware, the pads do not
  hw.setPartValue(0, CUTOFF, 40); hw.setPartValue(0, IFX_TYPE, 7); hw.setPartValue(0, IFX_EDIT, 99); hw.setPartValue(0, SAMPLE, 20);
  hw.setPartValue(3, CUTOFF, 70);
  go(d, 28, HOLD.slice(0, 2), "lock");
  assert.equal(hw.knobHold, 0x7FF, "all eleven knobs are kept from the firmware");
  assert.equal(d.leds[8], 255, "the EXIT LED lights the moment the lock takes, while the keys are still held");
  assert.equal(d.runtime.open, null, "no text while EXIT is held");
  go(d, 6, [release(2, "MFX_HOLD"), release(3, "EXIT")]);
  assert.ok(says(d, "PARTY LOCK AN", "EXIT+MFX HOLD 1S"), "the display says it once EXIT is let go");
  for (const k of LOCKED) assert.equal(hw.keyHold[key(k)], 1, `${k} is locked`);
  for (const k of ["PLAY", "STOP"]) assert.equal(hw.keyHold[key(k)], 0, `${k} stays`);
  assert.equal(hw.padHold, 0, "the pads still play");
  assert.equal(hw.touchLock, -1, "the touchpad is left alone");
  assert.equal(hw.objects[PCL], 1, "the main dial cannot change the pattern (PTN. CHANGE LOCK)");
  assert.ok(hw.pressedKeys.includes(key("TRIGGER")), "the pads go to TRIGGER mode, where a pad cannot change the pattern");
  const leds = new Set();
  for (let n = 0; n < 40; n++) { go(d, 1); leds.add(d.leds[8]); }
  assert.deepEqual([...leds].sort(), [0, 255], "the EXIT LED blinks while locked");
  go(d, 3, [press(0, "PLAY")]);
  assert.equal(hw.transport, 1, "PLAY still starts");
  go(d, 3, [press(0, "STOP")]);
  assert.equal(hw.transport, 0, "STOP still stops");
  go(d, 3, [event(0, "pad", 4, 1, 100), event(1, "pad", 4, 0, 0), event(1, "knob", 3, 200), event(2, "touch", 500, 500)]);

  // the encoders cannot be kept from the firmware: what a guest turns is turned back a frame later
  hw.setPartValue(0, CUTOFF, 90);
  go(d, 3, [event(0, "encoder", 2, 5)], "lock: encoder turned back");
  assert.equal(hw.patternValue(-1, 0, CUTOFF), 40, "CUTOFF is back");
  hw.setPartValue(0, IFX_TYPE, 12); hw.setPartValue(0, IFX_EDIT, 64);   // the firmware resets IFX EDIT with the type
  go(d, 3, [event(0, "encoder", 4, 1)]);
  assert.equal(hw.patternValue(-1, 0, IFX_TYPE), 7, "IFX TYPE is back");
  assert.equal(hw.patternValue(-1, 0, IFX_EDIT), 99, "and IFX EDIT with it");
  hw.setPartValue(0, SAMPLE, 300);
  go(d, 3, [event(0, "encoder", 1, -3)]);
  assert.equal(sampleOf(hw, 0), 20, "the sample is back");
  hw.part = 3; hw.setPartValue(3, CUTOFF, 1);
  go(d, 3, [event(0, "encoder", 2, -9)]);
  assert.equal(hw.patternValue(-1, 3, CUTOFF), 70, "also on a part selected after the lock");
  hw.part = 0;

  // the other combinations are off while locked
  fill(hw, 18, 54);
  go(d, 6, tap("PART_ERASE"));
  assert.equal(sampleOf(hw, 0), 20, "no roulette while locked");
  setMutes(hw, "1010000000000000");
  go(d, 40, [press(0, "EXIT"), press(1, "BAR_1"), release(25, "BAR_1"), release(26, "EXIT")]);
  go(d, 40, [press(0, "EXIT"), press(1, "PART_MUTE"), release(25, "PART_MUTE"), release(26, "EXIT")]);
  assert.equal(mutes(hw), "1010000000000000", "no scene and no drop while locked");
  setMutes(hw, "0000000000000000");

  // a new pattern while locked: its own values are the ones that come back
  hw.setPartValue(0, CUTOFF, 25);
  go(d, 14, [event(0, "patternChange", 5)]);
  hw.setPartValue(0, CUTOFF, 111);
  go(d, 3, [event(0, "encoder", 2, 9)]);
  assert.equal(hw.patternValue(-1, 0, CUTOFF), 25, "after a pattern change the new pattern's value comes back");

  // the same again unlocks, here at a moment when the LED is lit: everything goes back, the LED stays dark
  while (d.leds[8] !== 0) go(d, 1);
  while (d.leds[8] !== 255) go(d, 1);
  lock(d);
  assert.equal(hw.knobHold, 0, "the knobs are the firmware's again");
  for (const k of [...LOCKED, "PLAY", "STOP"]) assert.equal(hw.keyHold[key(k)], 0, `${k} is free`);
  assert.equal(hw.objects[PCL], 0, "PTN. CHANGE LOCK is as before");
  assert.ok(says(d, "PARTY LOCK AUS"), "the display says it");
  for (let n = 0; n < 30; n++) { go(d, 1); assert.equal(d.leds[8], 0, "EXIT LED dark when unlocked"); }
  hw.setPartValue(0, CUTOFF, 77);
  go(d, 3, [event(0, "encoder", 2, 1)]);
  assert.equal(hw.patternValue(-1, 0, CUTOFF), 77, "unlocked, an encoder is the user's again");

  // KEYBOARD mode chosen before the lock stays; a PTN. CHANGE LOCK the user had on stays on after unlocking
  d = boot(); hw = d.hardware;
  hw.objects[PCL] = 1;
  go(d, 3, [press(0, "KEYBOARD"), release(1, "KEYBOARD")]);
  lock(d);
  assert.equal(hw.knobHold, 0x7FF);
  assert.ok(!hw.pressedKeys.includes(key("TRIGGER")), "KEYBOARD mode stays for a guest who plays notes");
  lock(d);
  assert.equal(hw.objects[PCL], 1, "the user's own PTN. CHANGE LOCK stays on");

  // switched off while locked: the next start is unlocked and puts PTN. CHANGE LOCK back
  const sd = card();
  d = boot(sd); hw = d.hardware;
  lock(d);
  assert.equal(hw.objects[PCL], 1);
  const again = boot(sd);
  again.hardware.objects[PCL] = 1;   // the firmware saved its globals at power-off
  go(again, 4);
  assert.equal(again.hardware.objects[PCL], 0, "PTN. CHANGE LOCK is put back at the next start");
  assert.equal(again.hardware.knobHold, 0, "a restart is unlocked");
  assert.equal(again.hardware.keyHold[key("MENU")], 0);

  // EXIT's release can get lost on the device (it is not reported while any plugin shows a text). Then a later MFX HOLD or
  // PART ERASE alone must do nothing: a key that is not ours (EXIT + TAP is AUTO BPM's) ends our EXIT at once, and so do 5 s
  d = boot(); hw = d.hardware;
  fill(hw, 18, 54); hw.setPartValue(0, SAMPLE, 20);
  go(d, 4, [press(0, "EXIT"), press(1, "TAP"), release(2, "TAP")]);
  assert.equal(hw.keyHold[key("PART_ERASE")], 0, "after EXIT + TAP our keys are the firmware's again");
  go(d, 40, [press(0, "PART_ERASE"), release(1, "PART_ERASE"), press(3, "MFX_HOLD"), release(35, "MFX_HOLD")]);
  assert.equal(sampleOf(hw, 0), 20, "PART ERASE alone after a lost EXIT release does nothing");
  assert.equal(hw.knobHold, 0, "MFX HOLD alone never locks");
  go(d, 2, [release(0, "EXIT")]);
  go(d, 130, [press(0, "EXIT")]);
  assert.equal(hw.keyHold[key("PART_ERASE")], 0, "5 s after an EXIT press without anything our keys are the firmware's again");
  go(d, 4, [press(0, "PART_ERASE"), release(1, "PART_ERASE")]);
  assert.equal(sampleOf(hw, 0), 20);
  console.log("party lock ok");
}

// ------------------------------------------------------------------------------------------------------------- mute scenes
{
  const store = (d, k) => go(d, 24, [press(0, "EXIT"), press(1, k), release(19, k), release(20, "EXIT")], "scene store");
  const recall = (d, k) => go(d, 8, tap(k), "scene recall");
  const sd = card();
  let d = boot(sd), hw = d.hardware;

  // an empty memory changes nothing
  setMutes(hw, "0110000000000001");
  recall(d, "BAR_2");
  assert.equal(mutes(hw), "0110000000000001", "a tap on an empty scene changes nothing");
  assert.ok(says(d, "SZENE 2", "LEER"));
  go(d, 30);

  // holding 0.6 s stores, a tap recalls exactly that
  store(d, "BAR_1");
  assert.ok(says(d, "SZENE 1", "GEMERKT"), "the display says that it stored");
  assert.equal(mutes(hw), "0110000000000001", "storing changes no mute");
  go(d, 30);
  setMutes(hw, "1111111111111111");
  recall(d, "BAR_1");
  assert.equal(mutes(hw), "0110000000000001", "the tap brings scene 1 back, part by part");
  go(d, 30);

  // four memories, each its own; held 0.4 s is a tap
  const scenes = { BAR_2: "1000000000000000", BAR_3: "0000000000000000", BAR_4: "1111111101111111" };
  for (const [k, m] of Object.entries(scenes)) { setMutes(hw, m); store(d, k); go(d, 30); }
  for (const [k, m] of Object.entries({ BAR_1: "0110000000000001", ...scenes })) {
    setMutes(hw, "0101010101010101");
    recall(d, k);
    assert.equal(mutes(hw), m, `${k} recalls its own mutes`);
    go(d, 30);
  }
  setMutes(hw, "0000111100001111");
  go(d, 20, [press(0, "EXIT"), press(1, "BAR_2"), release(11, "BAR_2"), release(12, "EXIT")], "scene recall");
  assert.equal(mutes(hw), scenes.BAR_2, "0.4 s is still a tap: it recalls and does not store");
  go(d, 30);

  // EXIT let go before the key: still a tap
  setMutes(hw, "0000111100001111");
  go(d, 10, [press(0, "EXIT"), press(1, "BAR_4"), release(2, "EXIT"), release(4, "BAR_4")], "scene recall");
  assert.equal(mutes(hw), scenes.BAR_4, "let go in the other order it still recalls");

  // the keys 1 to 4 do not reach the firmware while EXIT is down, and alone they do nothing here
  go(d, 2, [press(0, "EXIT")]);
  for (const k of ["BAR_1", "BAR_2", "BAR_3", "BAR_4"]) assert.equal(hw.keyHold[key(k)], 1);
  go(d, 2, [release(0, "EXIT")]);
  setMutes(hw, "0000000000000000");
  go(d, 30, [press(0, "BAR_4"), release(25, "BAR_4")]);
  assert.equal(mutes(hw), "0000000000000000", "a key without EXIT is the firmware's");
  assert.equal(hw.keyHold[key("BAR_4")], 0);

  // the scenes survive a restart
  go(d, 60);
  const again = boot(sd);
  setMutes(again.hardware, "0000000000000000");
  recall(again, "BAR_4");
  assert.equal(mutes(again.hardware), scenes.BAR_4, "scene 4 is still there after a restart");
  console.log("mute scenes ok");
}

// -------------------------------------------------------------------------------------------------------------------- drop
{
  let d = boot(), hw = d.hardware;
  const BEFORE = "0010010001000000";   // parts 3, 6 and 10 are muted, the selected part 6 among them
  setMutes(hw, BEFORE); hw.part = 5;

  go(d, 6, [press(0, "EXIT"), press(1, "PART_MUTE")], "drop");
  assert.equal(mutes(hw), "1111101111111111", "only the selected part plays");
  assert.equal(hw.keyHold[key("PART_MUTE")], 1, "PART MUTE does not switch the pad mode");
  go(d, 200, [], "drop held");
  assert.equal(mutes(hw), "1111101111111111", "and stays so for as long as it is held");
  go(d, 6, [release(0, "PART_MUTE"), release(2, "EXIT")], "drop");
  assert.equal(mutes(hw), BEFORE, "letting go brings back exactly the mutes from before");

  // EXIT let go first: the drop stays for as long as PART MUTE is held. So the pads can be played over it: with EXIT down
  // they are BLECHTRIBE's EXIT + pad (a part's sound back to the saved values)
  go(d, 6, [press(0, "EXIT"), press(1, "PART_MUTE")], "drop");
  go(d, 60, [release(0, "EXIT")], "drop");
  assert.equal(mutes(hw), "1111101111111111", "EXIT may be let go, PART MUTE alone holds the drop");
  assert.equal(hw.padHold, 0);
  go(d, 6, [release(0, "PART_MUTE")], "drop");
  assert.equal(mutes(hw), BEFORE, "PART MUTE let go brings the mutes back");

  // the touchpad played during a drop is no key of somebody else's combination: EXIT stays ours
  fill(hw, 18, 54); hw.setPartValue(5, SAMPLE, 20);
  go(d, 6, [press(0, "EXIT"), press(1, "PART_MUTE"), press(3, "TOUCHPAD"), event(3, "touch", 300, 400), release(5, "TOUCHPAD")], "drop");
  assert.equal(hw.keyHold[key("PART_ERASE")], 1, "a finger on the touchpad does not end our EXIT");
  // and after 6 s of a held drop with EXIT still down, EXIT + PART ERASE still turns the roulette of the part that plays
  go(d, 150, [], "drop held");
  go(d, 4, [press(0, "PART_ERASE"), release(1, "PART_ERASE")], "roulette");
  assert.notEqual(sampleOf(hw, 5), 20, "a combination during a long drop still works");
  assert.equal(mutes(hw), "1111101111111111");
  go(d, 6, [release(0, "PART_MUTE"), release(1, "EXIT")], "drop");
  assert.equal(mutes(hw), BEFORE);

  // a pattern change in the middle: the new pattern's mutes stay
  go(d, 6, [press(0, "EXIT"), press(1, "PART_MUTE")], "drop");
  setMutes(hw, "0001000000000000");   // the firmware loaded the next pattern
  go(d, 6, [event(0, "patternChange", 7)]);
  go(d, 6, [release(0, "PART_MUTE"), release(1, "EXIT")]);
  assert.equal(mutes(hw), "0001000000000000", "the mutes of the old pattern are not put onto the new one");

  // no single part selected, or PART MUTE alone: nothing
  hw.part = 16;
  go(d, 8, [press(0, "EXIT"), press(1, "PART_MUTE"), release(4, "PART_MUTE"), release(5, "EXIT")]);
  hw.part = 2;
  go(d, 8, [press(0, "PART_MUTE"), release(4, "PART_MUTE")]);
  assert.equal(mutes(hw), "0001000000000000");
  console.log("drop ok");
}

// -------------------------------------------------------------------------------------------------------------- tempo ramp
{
  const sd = card();
  let d = boot(sd), hw = d.hardware;
  const pages = Object.fromEntries(d.menus.map(m => [m.label, m]));
  assert.deepEqual(Object.keys(pages), ["RAMP BPM", "RAMP TAKTE"], "the two pages of the plugin");
  assert.deepEqual([pages["RAMP BPM"].min, pages["RAMP BPM"].max, pages["RAMP BPM"].value], [1, 60, 10]);
  assert.deepEqual([pages["RAMP TAKTE"].min, pages["RAMP TAKTE"].max, pages["RAMP TAKTE"].value], [1, 16, 4]);
  d.menuSet(pages["RAMP BPM"].id, 20);
  d.menuSet(pages["RAMP TAKTE"].id, 2);
  go(d, 2);

  // stopped, the ramp waits for PLAY; then the tempo rises by 20 BPM over 2 bars and stays there
  hw.tempo = 1500;
  go(d, 6, tap("STEP_JUMP"), "ramp");
  assert.ok(says(d, "RAMPE BPM +20", "TAKTE 2"));
  assert.equal(hw.tempo, 1500, "stopped, nothing rises yet");
  assert.equal(hw.keyHold[key("STEP_JUMP")], 0);
  let steps = 0, last = 1500;
  const emit = hw.emit;
  const half = [];
  hw.emit = (name, ...args) => { if (name === "step") { steps += 1; if (steps === 16) half.push(hw.tempo); } return emit(name, ...args); };
  go(d, 1, [press(0, "PLAY")]);
  while (steps < 40) {
    go(d, 1, [], "ramp running");
    assert.ok(hw.tempo >= last && hw.tempo <= 1700, `the tempo only rises, to 170.0 at most: ${hw.tempo}`);
    last = hw.tempo;
  }
  assert.ok(half[0] >= 1575 && half[0] <= 1625, `half way after one bar, got ${half[0]}`);
  assert.equal(hw.tempo, 1700, "after 2 bars it is 20 BPM faster");
  go(d, 100);
  assert.equal(hw.tempo, 1700, "and stays there");

  // the same combination brings the old tempo back at once
  go(d, 6, tap("STEP_JUMP"), "ramp back");
  assert.equal(hw.tempo, 1500, "back to the tempo from before");
  assert.ok(says(d, "RAMPE ZURUECK"));
  go(d, 100);
  assert.equal(hw.tempo, 1500);

  // back in the middle of a ramp: it stops rising
  go(d, 6, tap("STEP_JUMP"));
  go(d, 30);
  assert.ok(hw.tempo > 1500 && hw.tempo < 1700, "in the middle");
  go(d, 6, tap("STEP_JUMP"));
  go(d, 100);
  assert.equal(hw.tempo, 1500, "back means back, nothing rises afterwards");

  // a pattern change in the middle: the new pattern's tempo is left alone, and the next press starts a new ramp from it
  go(d, 6, tap("STEP_JUMP"));
  go(d, 20);
  hw.tempo = 1400;   // the new pattern brings its own tempo
  go(d, 100, [event(0, "patternChange", 3)]);
  assert.equal(hw.tempo, 1400, "the ramp of the old pattern is over");
  go(d, 6, tap("STEP_JUMP"));
  go(d, 200);
  assert.equal(hw.tempo, 1600, "a new ramp starts from the new tempo");
  go(d, 6, tap("STEP_JUMP"));
  assert.equal(hw.tempo, 1400);

  // with TEMPO LOCK on a pattern change keeps the tempo, so the ramp keeps its way back
  hw.objects[TEMPO_LOCK] = 1;
  go(d, 6, tap("STEP_JUMP"));
  go(d, 200, [event(50, "patternChange", 4)]);
  assert.equal(hw.tempo, 1600);
  go(d, 6, tap("STEP_JUMP"));
  assert.equal(hw.tempo, 1400, "with TEMPO LOCK the way back survives the pattern change");
  hw.objects[TEMPO_LOCK] = 0;

  // the triplet beats (8 Tri, 16 Tri) have 12 steps to a bar: 2 bars are 24 steps there
  for (const beat of [2, 3]) {
    hw.setPatternValue(BEAT, beat); hw.tempo = 1500;
    go(d, 6, tap("STEP_JUMP"));
    steps = 0;
    while (steps < 24) go(d, 1);
    go(d, 1);
    assert.equal(hw.tempo, 1700, "in a triplet beat the 2 bars are over after 24 steps");
    go(d, 6, tap("STEP_JUMP"));
    go(d, 30);
  }
  hw.setPatternValue(BEAT, 0);

  // never above 300 BPM, and the settings survive a restart
  hw.tempo = 2950;
  go(d, 6, tap("STEP_JUMP"));
  go(d, 200);
  assert.equal(hw.tempo, 3000, "300.0 BPM is the end");
  go(d, 60);
  const again = boot(sd);
  assert.deepEqual(again.menus.map(m => m.value), [20, 2], "RAMP BPM and RAMP TAKTE are kept");

  // the 64 pages all plugins share (API 27; 12 before) are taken by the plugins loaded before: no page, but the ramp runs with 10 BPM over 4 bars
  d = new SimDevice(); hw = d.hardware;
  assert.ok(d.load(build("Filler", Array.from({ length: 64 }, (_, i) => `let p${i} = korg.menu.add("PAGE ${i}", 0, 1, 0);`).join("\n"))).ok);
  assert.ok(d.load(blob).ok, "the plugin loads without its pages");
  assert.equal(d.menus.filter(m => m.script === NAME).length, 0);
  hw.tempo = 1500;
  assert.deepEqual(d.run(6, tap("STEP_JUMP")), []);
  assert.deepEqual(d.run(700, [press(d.frames, "PLAY")]), []);
  assert.equal(hw.tempo, 1600, "without pages the ramp is 10 BPM");
  console.log("tempo ramp ok");
}

// ---------------------------------------------------------------------------------------------------------------- bar copy
{
  // korg.seq.writeSteps clamps the velocity to 1 to 127, so the 0 of a step that was never set arrives as 1; it is compared as 1
  const bar = (hw, part, n) => Array.from({ length: 16 }, (_, s) => { const v = hw.stepValue(part, n * 16 + s); return JSON.stringify({ ...v, velocity: Math.max(1, v.velocity) }); }).join();
  const write = (hw, part, n, seed) => {
    for (let s = 0; s < 16; s += 1 + (seed % 3)) { hw.setStep(part, n * 16 + s, 36 + ((s * 7 + seed) % 40), 60 + s * 4); hw.patternBlock(-1)[hw.stepAt(part, n * 16 + s) + 1] = 40 + s * 5; }
  };
  const fresh = bars => {
    const d = boot(), hw = d.hardware;
    hw.setPatternValue(LENGTH, bars);
    for (let p = 0; p < 16; p++) { write(hw, p, 0, p + 1); write(hw, p, 1, p + 40); }
    hw.part = 3;
    return d;
  };
  const length = hw => hw.patternValue(-1, -1, LENGTH);

  // SHIFT held, key 1 then key 2: bar 1 of the selected part is in bar 2, step for step; the other parts are untouched
  let d = fresh(2), hw = d.hardware;
  const source = bar(hw, 3, 0), others = [0, 1, 2, 4, 5, 15].map(p => bar(hw, p, 1));
  assert.notEqual(bar(hw, 3, 1), source);
  go(d, 2, [press(0, "SHIFT")]);
  for (const k of ["BAR_1", "BAR_2", "BAR_3", "BAR_4"]) assert.equal(hw.keyHold[key(k)], 1, "the keys 1 to 4 are ours while SHIFT is held");
  go(d, 8, [press(0, "BAR_1"), release(1, "BAR_1"), press(3, "BAR_2"), release(4, "BAR_2"), release(6, "SHIFT")], "bar copy, one part");
  assert.equal(bar(hw, 3, 1), source, "bar 2 of the part is bar 1 now: on, gate, velocity, trigger and notes");
  assert.equal(bar(hw, 3, 0), source, "the source bar stays");
  assert.deepEqual([0, 1, 2, 4, 5, 15].map(p => bar(hw, p, 1)), others, "no other part is touched");
  assert.ok(says(d, "TAKT 1 > 2"));
  assert.equal(hw.keyHold[key("BAR_1")], 0);
  assert.equal(hw.quickSaves, 0, "copying does not save by itself");

  // one source, several targets while SHIFT stays down; the source onto itself does nothing
  d = fresh(4); hw = d.hardware;
  go(d, 12, [press(0, "SHIFT"), press(1, "BAR_2"), release(2, "BAR_2"), press(3, "BAR_2"), release(4, "BAR_2"), press(5, "BAR_3"), release(6, "BAR_3"),
    press(7, "BAR_4"), release(8, "BAR_4"), release(10, "SHIFT")], "bar copy, one part");
  assert.equal(bar(hw, 3, 2), bar(hw, 3, 1));
  assert.equal(bar(hw, 3, 3), bar(hw, 3, 1), "the first key stays the source for every further key");
  assert.notEqual(bar(hw, 3, 0), bar(hw, 3, 1), "bar 1 was not a target");

  // with EXIT as well: all 16 parts, a few per frame; a target behind the end makes the pattern longer
  d = fresh(2); hw = d.hardware;
  const all = Array.from({ length: 16 }, (_, p) => bar(hw, p, 0));
  go(d, 12, [press(0, "EXIT"), press(1, "SHIFT"), press(2, "BAR_1"), release(3, "BAR_1"), press(4, "BAR_3"), release(5, "BAR_3"), release(9, "SHIFT"), release(10, "EXIT")],
    "bar copy, all parts");
  assert.deepEqual(Array.from({ length: 16 }, (_, p) => bar(hw, p, 2)), all, "bar 3 of every part is its bar 1");
  assert.equal(length(hw), 3, "the pattern is 3 bars long now");
  assert.ok(says(d, "TAKT 1 > 3", "ALLE PARTS"));

  // a second target right behind the first: the copy that is still under way is finished, not dropped
  d = fresh(4); hw = d.hardware;
  const firsts = Array.from({ length: 16 }, (_, p) => bar(hw, p, 0));
  go(d, 12, [press(0, "EXIT"), press(1, "SHIFT"), press(2, "BAR_1"), press(3, "BAR_2"), press(4, "BAR_3"), release(9, "SHIFT"), release(10, "EXIT")],
    "bar copy, all parts, two targets within 160 ms");
  assert.deepEqual(Array.from({ length: 16 }, (_, p) => bar(hw, p, 1)), firsts, "bar 2 of every part is complete");
  assert.deepEqual(Array.from({ length: 16 }, (_, p) => bar(hw, p, 2)), firsts, "and bar 3 as well");

  // one part only never changes the length: a target behind the end is refused, and so is a source behind it
  d = fresh(2); hw = d.hardware;
  const untouched = bar(hw, 3, 3);
  go(d, 10, [press(0, "SHIFT"), press(1, "BAR_1"), release(2, "BAR_1"), press(3, "BAR_4"), release(4, "BAR_4"), release(6, "SHIFT")]);
  assert.equal(bar(hw, 3, 3), untouched, "bar 4 is not part of a 2 bar pattern: nothing is written");
  assert.equal(length(hw), 2);
  assert.ok(says(d, "TAKT 4 FEHLT"));
  go(d, 30);
  const first = bar(hw, 3, 0);
  go(d, 10, [press(0, "SHIFT"), press(1, "BAR_3"), release(2, "BAR_3"), press(3, "BAR_1"), release(4, "BAR_1"), release(6, "SHIFT")]);
  assert.equal(bar(hw, 3, 0), first, "an empty bar behind the end is no source");

  // without SHIFT the keys are the firmware's; SHIFT let go between the two keys starts over
  go(d, 30);
  const second = bar(hw, 3, 1);
  go(d, 10, [press(0, "BAR_1"), release(1, "BAR_1"), press(3, "BAR_2"), release(4, "BAR_2")]);
  go(d, 12, [press(0, "SHIFT"), press(1, "BAR_1"), release(2, "BAR_1"), release(3, "SHIFT"), press(5, "SHIFT"), press(6, "BAR_2"), release(7, "BAR_2"), release(9, "SHIFT")]);
  assert.equal(bar(hw, 3, 1), second, "one key per SHIFT copies nothing");

  // a pattern change in the middle of a copy of all parts: the rest is not written into the new pattern
  d = fresh(2); hw = d.hardware;
  const late = bar(hw, 15, 1);
  go(d, 4, [press(0, "EXIT"), press(1, "SHIFT"), press(2, "BAR_1"), press(3, "BAR_2")], "bar copy, all parts");
  go(d, 10, [event(0, "patternChange", 9)]);
  assert.equal(bar(hw, 15, 1), late, "after the pattern change nothing more is copied");
  console.log("bar copy ok");
}

// ------------------------------------------------------------------------------------------------------------------ chance
{
  // part 3 plays on every beat (steps 0, 4, 8, 12 of one bar). Returns how many of its hits found the part muted and whether the
  // part was ever muted on a step without a hit.
  const run = (d, hits, part = 2, where = "step with CHANCE on one part") => {
    const hw = d.hardware, emit = hw.emit, seen = { hits: 0, muted: 0, between: 0 };
    hw.emit = (name, ...args) => {
      if (name === "step" && seen.hits < hits) {
        if (hw.stepValue(part, args[0]).on) { seen.hits += 1; seen.muted += hw.mutes[part]; } else seen.between += hw.mutes[part];
      }
      return emit(name, ...args);
    };
    while (seen.hits < hits) go(d, 1, [], where);
    hw.emit = emit;
    return seen;
  };
  const fresh = () => {
    const d = boot(), hw = d.hardware;
    hw.setPatternValue(LENGTH, 1);
    for (const s of [0, 4, 8, 12]) { hw.setStep(2, s, 60, 100); hw.setStep(6, s, 60, 100); }
    hw.part = 2; hw.tempo = 1700;
    return d;
  };
  const cycle = d => go(d, 6, tap("MFX_SEND"), "chance set");

  // off: every hit plays
  let d = fresh(), hw = d.hardware;
  const pattern = Buffer.from(hw.patternBlock(-1)).toString("hex");
  go(d, 2, [press(0, "PLAY")]);
  assert.equal(run(d, 100, 2, "step with CHANCE off").muted, 0, "without CHANCE every step triggers");

  // EXIT + MFX SEND steps through 75, 50, 25 percent and off, for the selected part only
  for (const [percent, low, high] of [[75, 0.15, 0.35], [50, 0.4, 0.6], [25, 0.65, 0.85]]) {
    cycle(d);
    assert.ok(says(d, "CHANCE PART 3", `${percent} PROZENT`), `the display says ${percent}`);
    assert.equal(hw.keyHold[key("MFX_SEND")], 0);
    go(d, 30);
    const seen = run(d, 600);
    const dropped = seen.muted / seen.hits;
    assert.ok(dropped >= low && dropped <= high, `at ${percent} percent ${Math.round(dropped * 100)} percent of the hits are dropped`);
    assert.equal(seen.between, 0, "the part is muted only for the step of a dropped hit");
    assert.equal(run(d, 200, 6).muted, 0, "a part without CHANCE always plays");
  }
  assert.equal(Buffer.from(hw.patternBlock(-1)).toString("hex"), pattern, "CHANCE writes no step and nothing else into the pattern block");

  // STOP gives a part muted by CHANCE back
  for (let n = 0; n < 20; n++) {
    while (!hw.mutes[2]) go(d, 1);
    go(d, 3, [press(0, "STOP")]);
    assert.equal(hw.mutes[2], 0, "stopped, the part is not left muted");
    go(d, 2, [press(0, "PLAY")]);
  }

  // a part the user muted himself stays muted, CHANCE never opens it
  go(d, 3, [press(0, "STOP")]);
  hw.mutes[2] = 1;
  go(d, 2, [press(0, "PLAY")]);
  let seen = run(d, 200);
  assert.equal(seen.muted, 200, "the user's own mute stays");
  go(d, 3, [press(0, "STOP")]);
  assert.equal(hw.mutes[2], 1, "also after STOP");
  hw.mutes[2] = 0;

  // while a DROP is held CHANCE keeps its hands off, and the DROP gives back the user's mutes, not CHANCE's
  hw.part = 6;
  go(d, 2, [press(0, "PLAY")]);
  for (let n = 0; n < 10; n++) {
    while (!hw.mutes[2]) go(d, 1);
    go(d, 3, [press(0, "EXIT"), press(1, "PART_MUTE")], "drop");
    for (let f = 0; f < 60; f++) { go(d, 1); assert.equal(mutes(hw), "1111110111111111", "CHANCE opens nothing during a DROP"); }
    go(d, 2, [release(0, "PART_MUTE"), release(0, "EXIT"), press(0, "STOP")], "drop");
    assert.equal(mutes(hw), "0000000000000000", "after the DROP the mutes are the user's: none");
    go(d, 2, [press(0, "PLAY")]);
  }
  hw.part = 2;

  // the part a DROP leaves playing plays every hit, and a mute the user had on it is back afterwards and stays
  go(d, 3, [press(0, "STOP")]);
  hw.mutes[2] = 1;
  go(d, 6, [press(0, "PLAY"), press(1, "EXIT"), press(2, "PART_MUTE")], "drop");
  assert.equal(run(d, 60).muted, 0, "CHANCE rests while a DROP is held");
  go(d, 4, [release(0, "PART_MUTE"), release(1, "EXIT")], "drop");
  assert.equal(run(d, 200).muted, 200, "the user's mute is back after the DROP and CHANCE leaves it");
  go(d, 3, [press(0, "STOP")]);
  hw.mutes[2] = 0;
  go(d, 2, [press(0, "PLAY")]);

  // the fourth press is off again
  cycle(d);
  assert.ok(says(d, "CHANCE PART 3", "AUS"));
  go(d, 30);
  assert.equal(mutes(hw), "0000000000000000");
  assert.equal(run(d, 200).muted, 0, "off again: every step triggers");

  // a scene stored while CHANCE holds a part muted stores the user's mutes (a hit on every step, so it is muted most of the time)
  const sd = card();
  d = boot(sd); hw = d.hardware;
  hw.setPatternValue(LENGTH, 1);
  for (let s = 0; s < 16; s++) hw.setStep(2, s, 60, 100);
  hw.part = 2; hw.tempo = 1700;
  cycle(d); cycle(d); cycle(d);
  for (let n = 0; n < 12; n++) {
    go(d, 30 + n, [press(0, "PLAY")]);
    go(d, 24, [press(0, "EXIT"), press(1, "BAR_1"), release(19, "BAR_1"), release(20, "EXIT"), press(21, "STOP")], "scene store");
    setMutes(hw, "1111111111111111");
    go(d, 30);
    go(d, 8, tap("BAR_1"), "scene recall");
    assert.equal(mutes(hw), "0000000000000000", "the scene holds the user's mutes, not the one CHANCE had set at that moment");
    go(d, 30);
  }

  // a scene recalled while CHANCE holds the part muted, with the part muted in the scene: it stays muted
  setMutes(hw, "0010000000000000");
  go(d, 24, [press(0, "EXIT"), press(1, "BAR_2"), release(19, "BAR_2"), release(20, "EXIT")]);
  setMutes(hw, "0000000000000000");
  go(d, 30);
  for (let n = 0; n < 8; n++) {
    go(d, 20 + n, [press(0, "PLAY")]);
    while (!hw.mutes[2]) go(d, 1);
    go(d, 8, tap("BAR_2"), "scene recall");
    assert.equal(run(d, 100).muted, 100, "the scene's mute is the user's: CHANCE does not open it");
    go(d, 30, [press(0, "STOP")]);
    setMutes(hw, "0000000000000000");
  }

  // a pattern change while CHANCE holds the part muted, the new pattern has the part muted: it stays muted
  for (let n = 0; n < 8; n++) {
    go(d, 20 + n, [press(0, "PLAY")]);
    while (!hw.mutes[2]) go(d, 1);
    go(d, 1, [event(0, "patternChange", n)]);
    hw.mutes[2] = 1;
    assert.equal(run(d, 100).muted, 100, "the new pattern's mute is not CHANCE's to open");
    go(d, 3, [press(0, "STOP")]);
    setMutes(hw, "0000000000000000");
  }

  // a triplet beat: the counter runs 0 to 11 and starts over (12 to 15 are never played), the first hit of the bar is
  // decided on step 11
  d = boot(); hw = d.hardware;
  hw.setPatternValue(LENGTH, 1); hw.setPatternValue(BEAT, 2);
  for (const s of [0, 6]) hw.setStep(2, s, 60, 100);
  hw.part = 2;
  cycle(d); go(d, 30); cycle(d); go(d, 30);
  let firsts = 0, dropped = 0;
  for (let n = 0; n < 12 * 400; n++) {
    const s = n % 12;
    if (s === 0) { firsts += 1; dropped += hw.mutes[2]; }
    hw.steps.fill(s);
    go(d, 1, [event(0, "step", s)], "step with CHANCE on one part");
  }
  assert.ok(dropped / firsts > 0.4 && dropped / firsts < 0.6, `at 50 percent the first hit of a triplet bar is dropped ${Math.round(100 * dropped / firsts)} times in 100`);

  // the dearest case: CHANCE on all 16 parts, a hit on every step
  d = boot(); hw = d.hardware;
  hw.setPatternValue(LENGTH, 1); hw.tempo = 2000;
  for (let p = 0; p < 16; p++) {
    for (let s = 0; s < 16; s++) hw.setStep(p, s, 60, 100);
    hw.part = p;
    cycle(d); cycle(d);
  }
  go(d, 30);
  go(d, 400, [press(0, "PLAY")], "step with CHANCE on all 16 parts");
  go(d, 3, [press(0, "STOP")], "STOP with CHANCE on all 16 parts");
  assert.equal(mutes(hw), "0000000000000000");
  console.log("chance ok");
}

// ------------------------------------------------------------------------------------------------- what the device shows
{
  const top = [];
  for (const line of source(NAME).split("\n")) { const m = /^\/\/ ?(.*)$/.exec(line); if (!m) break; top.push(m[1]); }
  const shown = describeSource(source(NAME)).split("\n").slice(0, -1);
  assert.deepEqual(shown, top.map(l => l.trim()), "the device shows the description line for line as it is written");
  assert.ok(shown.every(l => l.length <= DESC_TRAILER.width), "20 characters a line");
  assert.ok(shown.join("\n").length + 1 <= DESC_TRAILER.maxBytes, "the whole description fits");
  const text = shown.join(" ");
  for (const combo of ["EXIT + PART ERASE", "EXIT + MFX HOLD", "EXIT + Taste 1 bis 4", "EXIT + PART MUTE", "EXIT + STEP JUMP", "EXIT + MFX SEND", "SHIFT"]) {
    assert.ok(text.includes(combo), `the description names ${combo}`);
  }
  for (const page of ["RAMP BPM", "RAMP TAKTE"]) assert.ok(text.includes(page) && page.length <= 15);
  assert.ok(blob.length <= ARCHIVE.maxBlock, `the block has ${blob.length} bytes`);
  // what the build does with every plugin: the probe run and the .blech file
  const probed = probe(blob, [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP"), release(12, "EXIT")], { minFrames: 200 });
  assert.ok(probed.ok, JSON.stringify(probed.loadError ?? probed.faults));
  assert.ok(packBlech(markProbed(blob), source(NAME)).ok, "the .blech file packs");
  console.log(`${NAME}: all tests ok`);
  console.log(`${NAME}: block ${blob.length} of ${ARCHIVE.maxBlock} bytes`);
  console.log(`${NAME}: dearest frame of each kind, in fuel units (a frame without a key, a step or a timer costs 0):`);
  for (const [where, cost] of [...costs].sort((a, b) => b[1] - a[1])) console.log(`  ${String(cost).padStart(5)}  ${where}`);
}
