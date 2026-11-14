// AUDIO IN: the switches of the firmware's Audio In functions as pages in FEATURES, under the names the firmware looks
// for (out/district-swap tools/patch/audio_in.py: PAGE_PAD, PAGE_LEVEL, PAGE_BUF, PAGE_PANIC), with value names, kept over a restart.
// Run from the project root: DISTRICT_DIR=out/district-swap node plugins/api26/AudioIn.test.mjs
import assert from "node:assert/strict";
import { build, SimDevice } from "../../tools/plugins/sim-kit.mjs";

/** The card: what korg.store.save wrote, by plugin name. */
function card() {
  const saved = new Map();
  return { load: name => saved.get(name) ?? null, save: records => { for (const r of records) saved.set(r.name, { mask: r.mask, values: Array.from(r.values) }); } };
}
function device(storage = null) {
  const d = new SimDevice({ storage });
  assert.ok(d.load(build("AudioIn")).ok);
  assert.deepEqual(d.run(2), [], "no fault");
  return d;
}
const page = (d, label) => d.menus.find(m => m.label === label) ?? assert.fail(`no page ${label}`);

{
  const d = device();
  assert.deepEqual(d.menus.map(m => [m.label, m.min, m.max, m.value, m.group, m.text]),
    [["AUDIO IN PAD", 0, 2, 2, "FEATURES", "STEREO"], ["AUDIO IN PEGEL", 0, 127, 127, "FEATURES", ""],
     ["AUDIO IN PUFFER", 0, 30, 4, "FEATURES", ""], ["PANIC", 0, 1, 1, "FEATURES", "AN"]],
    "four pages in FEATURES: stereo, full level, 4 s and on as they come; the firmware reads them by these names");
  for (const m of d.menus) assert.ok(m.label.length <= 15, `${m.label} fits the line`);
}
{
  const store = card();
  const d = device(store);
  d.menuSet(page(d, "AUDIO IN PAD").id, 0);
  d.menuSet(page(d, "AUDIO IN PEGEL").id, 0);
  d.menuSet(page(d, "AUDIO IN PUFFER").id, 0);
  d.menuSet(page(d, "PANIC").id, 0);
  assert.deepEqual(d.run(2), []);
  assert.deepEqual(d.menus.map(m => m.text), ["AUS", "", "AUS", "AUS"], "0 is AUS on every switch, the level stays a number");
  d.menuSet(page(d, "AUDIO IN PAD").id, 1);
  d.menuSet(page(d, "AUDIO IN PEGEL").id, 90);
  d.menuSet(page(d, "AUDIO IN PUFFER").id, 12);
  assert.deepEqual(d.run(2), []);
  assert.equal(page(d, "AUDIO IN PAD").text, "MONO", "1 is MONO");
  assert.equal(page(d, "AUDIO IN PUFFER").text, "", "seconds show as a number");
  const again = device(store);
  assert.deepEqual(again.menus.map(m => [m.label, m.value, m.text]),
    [["AUDIO IN PAD", 1, "MONO"], ["AUDIO IN PEGEL", 90, ""], ["AUDIO IN PUFFER", 12, ""], ["PANIC", 0, "AUS"]],
    "the values come back after a restart");
}
{
  // a card from 0.3.1: slot 0 kept 1 for AN, the level was never stored
  const store = card();
  store.save([{ name: "AudioIn", mask: 0b111, values: [1, 4, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]);
  const d = device(store);
  assert.deepEqual(d.menus.map(m => [m.label, m.value, m.text]).slice(0, 2), [["AUDIO IN PAD", 1, "MONO"], ["AUDIO IN PEGEL", 127, ""]],
    "0.3.1's AN stays MONO, the level starts at 127");
}
console.log("AudioIn: tests ok");
