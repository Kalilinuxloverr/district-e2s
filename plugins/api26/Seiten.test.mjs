// The pages of all DISTRICT plugins in the BLECH menu: every page sits in a firmware group (FEATURES, CUSTOMIZATION, DEV),
// none is left under PLUGINS, and every mode shows its name instead of a bare number, from the start and after each turn.
// Run: node plugins/api26/Seiten.test.mjs        (needs the fork at API 27: korg.menu.group, korg.menu.text)
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { root, build, SimDevice, API_VERSION } from "../../tools/plugins/sim-kit.mjs";

assert.ok(API_VERSION >= 27, "the pages need API 27");
const names = readdirSync(join(root, "plugins/api26")).filter(f => f.endsWith(".js")).map(f => basename(f, ".js")).sort();
function device() {
  const d = new SimDevice();
  for (const name of names) assert.ok(d.load(build(name)).ok, `${name} loads`);
  assert.deepEqual(d.run(3), []);
  return d;
}
const page = (d, label) => d.menus.find(m => m.label === label) ?? assert.fail(`no page ${label}`);

const GROUPS = {
  FEATURES: ["AUTO WRITE", "MELODY", "RAMP BPM", "RAMP TAKTE", "AUDIO IN PAD", "AUDIO IN PEGEL", "AUDIO IN PUFFER", "PANIC"],
  CUSTOMIZATION: ["DISPLAY MODE", "DISPLAY SPEED", "HELL", "UNTEN MODE", "UNTEN SPEED", "PARTY MODE", "PARTY SPEED", "BOOT WAVE"],
};
const TEXTS = {
  "AUTO WRITE": ["AUS", "2 S", "5 S", "10 S", "30 S"],
  "MELODY": ["RANDOM", "HARDTEKK", "BASS"],
  "DISPLAY MODE": ["AUS", "FADE", "BEAT", "GRUEN", "PULS", "STROBE", "STATUS", "PART BLITZ", "PATTERN"],
  "UNTEN MODE": ["NORMAL", "FADE", "BEAT", "PULS", "METER BUNT", "LAUFLICHT"],
  "PARTY MODE": ["AUS", "FADE", "STROBE", "LAUFLICHT", "CHAOS"],
  "BOOT WAVE": ["AUS", "AN"],
  "AUDIO IN PAD": ["AUS", "MONO", "STEREO"],
  "PANIC": ["AUS", "AN"],
};

{
  const d = device();
  for (const m of d.menus) assert.ok(m.group, `${m.script}: page ${m.label} is still under PLUGINS`);
  for (const [group, labels] of Object.entries(GROUPS)) {
    assert.deepEqual(d.menus.filter(m => m.group === group).map(m => m.label).sort(), [...labels].sort(), `the pages in ${group}`);
  }
  assert.ok(d.menus.filter(m => m.group === "DEV").length >= 10, "the statistics are in DEV");
  for (const [label, texts] of Object.entries(TEXTS)) {
    const m = page(d, label);
    assert.equal(m.text, texts[m.value], `${label} shows its name from the start`);
  }
  for (const label of ["DISPLAY SPEED", "HELL", "UNTEN SPEED", "PARTY SPEED", "RAMP BPM", "RAMP TAKTE", "AUDIO IN PEGEL", "AUDIO IN PUFFER"]) {
    assert.equal(page(d, label).text, "", `${label} is a number`);
  }
}
for (const [label, texts] of Object.entries(TEXTS)) {
  const d = device();
  const id = page(d, label).id;
  for (const v of [...texts.keys(), 0]) {
    d.menuSet(id, v);
    assert.deepEqual(d.run(2), []);
    assert.equal(page(d, label).text, texts[v], `${label} turned to ${v} shows ${texts[v]}`);
  }
}
console.log(`Seiten: tests ok, ${device().menus.length} pages`);
