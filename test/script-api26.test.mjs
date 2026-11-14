import { test } from "node:test";
import assert from "node:assert/strict";
import { API_VERSION, API_BY_NAME, EVENTS } from "../data/script/contract.mjs";
import { asmInclude } from "../src/script/arm-tables.mjs";
import { compile, formatError } from "../src/script/compiler.mjs";
import { decodeBlob } from "../src/script/blob.mjs";
import { SimDevice } from "../src/script/sim.mjs";

const build = (name, source) => {
  const result = compile(source, { name });
  assert.ok(result.ok, result.errors?.map(formatError).join("\n"));
  return result.blob;
};
const run = (source, setup = () => {}) => {
  const sim = new SimDevice();
  setup(sim);
  const loaded = sim.load(build("api26", source));
  assert.equal(loaded.error, null);
  sim.frame();
  return sim;
};
const vars = sim => Array.from(sim.runtime.scripts[0].script.vars);
const NAMES = ["korg.backlightLevel", "korg.backlightRelease", "korg.bottomLed", "korg.bottomRelease", "korg.read.sampleFrames",
  "korg.read.sampleRate", "korg.read.sampleTune", "korg.read.unsaved", "korg.quickSave"];

test("API 26 adds nine calls at the end of the list, with their ranges and events", () => {
  assert.deepEqual(NAMES.map(n => API_BY_NAME.get(n).id), [106, 107, 108, 109, 110, 111, 112, 113, 114]);
  for (const n of NAMES) assert.equal(API_BY_NAME.get(n).since, 26, n);
  const range = n => API_BY_NAME.get(n).args.map(a => [a.name, a.min, a.max]);
  assert.deepEqual(range("korg.backlightLevel"), [["red", 0, 15], ["green", 0, 15], ["blue", 0, 15]]);
  assert.deepEqual(range("korg.bottomLed"), [["led", 0, 3], ["red", 0, 255], ["green", 0, 255], ["blue", 0, 255]]);
  for (const n of ["korg.read.sampleFrames", "korg.read.sampleRate", "korg.read.sampleTune"]) assert.deepEqual(range(n), [["index", 0, 998]], n);
  const led = API_BY_NAME.get("korg.led").eventMask;
  for (const n of ["korg.backlightLevel", "korg.backlightRelease", "korg.bottomLed", "korg.bottomRelease", "korg.quickSave"]) assert.equal(API_BY_NAME.get(n).eventMask, led, `${n} runs where korg.led runs`);
  const everywhere = EVENTS.reduce((m, e) => m | (1 << e.id), 0) >>> 0;
  for (const n of NAMES.filter(n => n.startsWith("korg.read."))) assert.equal(API_BY_NAME.get(n).eventMask, everywhere, `${n} runs in every event`);
  assert.deepEqual(NAMES.filter(n => API_BY_NAME.get(n).returns === "int"), NAMES.slice(4));
  const equ = Object.fromEntries([...asmInclude().matchAll(/^\.equ (\w+), (\w+)$/gm)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual([equ.API_KORG_BACKLIGHT_LEVEL, equ.API_KORG_BOTTOM_LED, equ.API_KORG_READ_SAMPLE_FRAMES, equ.API_KORG_READ_UNSAVED, equ.API_KORG_QUICK_SAVE], [106, 108, 110, 113, 114]);
});

test("a block needs API 26 only when it uses one of the new calls", () => {
  const version = source => decodeBlob(build("v", source)).header.apiVersion;
  for (const call of ["korg.backlightLevel(1, 2, 3);", "korg.backlightRelease();", "korg.bottomLed(0, 1, 2, 3);", "korg.bottomRelease();",
    "let f = korg.read.sampleFrames(500);", "let r = korg.read.sampleRate(500);", "let t = korg.read.sampleTune(500);", "let u = korg.read.unsaved();", "let s = korg.quickSave();"]) {
    assert.equal(version(`korg.onEvent("frame", () => { ${call} });`), 26, call);
  }
  assert.ok(version(`korg.onEvent("frame", () => { korg.led(0, 255); });`) < 26);
  assert.equal(compile(`korg.backlightLevel(1, 2, 3);`, { name: "body" }).ok, false, "not in the body, like korg.led");
});

test("korg.backlightLevel sets the three levels until the release, and refuses a level above 15", () => {
  const sim = run(`korg.onEvent("ready", () => { korg.backlightLevel(15, 0, 7); });
    korg.onEvent("buttonPress", (k) => { korg.backlightRelease(); });`);
  assert.deepEqual(sim.hardware.backlightLevels, [15, 0, 7]);
  assert.deepEqual(sim.hardware.backlight, [1, 1, 1], "korg.backlight's own switches are another thing");
  sim.post("buttonPress", 3);
  sim.frame();
  assert.equal(sim.hardware.backlightLevels, null, "back to the colour of the settings");
  const bad = run(`let level = 16; korg.onEvent("ready", () => { korg.backlightLevel(level, 0, 0); });`);
  assert.equal(bad.runtime.scripts[0].script.fault?.name, "API_ARG");
  assert.equal(bad.hardware.backlightLevels, null);
});

test("korg.bottomLed colours one bottom LED and leaves the others, a brightness of 1 is 2, the release gives all four back", () => {
  const sim = run(`korg.onEvent("ready", () => { korg.bottomLed(2, 255, 1, 0); korg.bottomLed(0, 10, 20, 30); });
    korg.onEvent("buttonPress", (k) => { korg.bottomRelease(); });`);
  assert.deepEqual(sim.hardware.bottomLeds, [[10, 20, 30], null, [255, 2, 0], null]);
  assert.equal(sim.hardware.ledHold, 0, "without korg.ledHold");
  sim.post("buttonPress", 3);
  sim.frame();
  assert.deepEqual(sim.hardware.bottomLeds, [null, null, null, null]);
  const bad = run(`let led = 4; korg.onEvent("ready", () => { korg.bottomLed(led, 0, 0, 0); });`);
  assert.equal(bad.runtime.scripts[0].script.fault?.name, "API_ARG");
});

test("a plugin that stops gives the light and the bottom LEDs back, another plugin's stay", () => {
  const sim = new SimDevice();
  assert.equal(sim.load(build("owner", `let zero = 0; let n = 0;
    korg.onEvent("ready", () => { korg.backlightLevel(3, 3, 3); korg.bottomLed(1, 9, 9, 9); });
    korg.onEvent("buttonPress", (k) => { n = 1 / zero; });`)).error, null);
  assert.equal(sim.load(build("other", `let n = 0; korg.onEvent("pad", (i, down, v) => { n = 1 / n; });`)).error, null);
  sim.frame();
  sim.post("pad", 0, 1, 100);
  sim.frame();
  assert.equal(sim.runtime.scripts[1].script.state, "disabled", "the other plugin faulted");
  assert.deepEqual([sim.hardware.backlightLevels, sim.hardware.bottomLeds[1]], [[3, 3, 3], [9, 9, 9]], "the owner still runs");
  sim.post("buttonPress", 3);
  sim.frame();
  assert.equal(sim.runtime.scripts[0].script.state, "disabled");
  assert.equal(sim.hardware.backlightLevels, null);
  assert.deepEqual(sim.hardware.bottomLeds, [null, null, null, null]);
});

test("the sample calls read the table by index: frames, rate and tune, nothing for an oscillator or an empty slot", () => {
  const sim = run(`let a = 0; let b = 0; let c = 0; let d = 0; let e = 0; let f = 0; let g = 0;
    korg.onEvent("ready", () => {
      a = korg.read.sampleFrames(500); b = korg.read.sampleRate(500); c = korg.read.sampleTune(500);
      d = korg.read.sampleFrames(5); e = korg.read.sampleFrames(998); f = korg.read.sampleRate(998); g = korg.read.sampleTune(998);
    });`, s => {
    s.hardware.samples.set(500, { frames: 21007, rate: 44100, tune: -12 });
    s.hardware.samples.set(5, { frames: 777, rate: 48000, tune: 0 });
  });
  assert.deepEqual(vars(sim).slice(0, 7), [21007, 44100, -12, 0, 0, 48000, 0]);
  const bad = run(`let i = 999; let a = 0; korg.onEvent("ready", () => { a = korg.read.sampleFrames(i); });`);
  assert.equal(bad.runtime.scripts[0].script.fault?.name, "API_ARG");
});

test("korg.read.unsaved follows the flag, korg.quickSave saves once, clears it and says when it cannot run", () => {
  const sim = run(`let before = 0; let saved = 0; let after = 0; let again = 0;
    korg.onEvent("ready", () => { before = korg.read.unsaved(); saved = korg.quickSave(); after = korg.read.unsaved(); });
    korg.onEvent("buttonPress", (k) => { again = korg.quickSave(); });`, s => { s.hardware.unsaved = 1; });
  assert.deepEqual(vars(sim).slice(0, 3), [1, 1, 0]);
  assert.deepEqual([sim.hardware.quickSaves, sim.hardware.unsaved], [1, 0]);
  sim.hardware.unsaved = 1;
  sim.hardware.canSave = 0;
  sim.post("buttonPress", 3);
  sim.frame();
  assert.equal(vars(sim)[3], 0, "not now");
  assert.deepEqual([sim.hardware.quickSaves, sim.hardware.unsaved], [1, 1], "nothing was saved");
});
