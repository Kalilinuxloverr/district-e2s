// DEV: the pages of the group DEV show what the firmware's RAM says.
// Run from the project root: node plugins/api26/Dev.test.mjs   (needs the fork with API 27, district/ by default)
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { boot, fork, API_VERSION } from "../../tools/plugins/sim-kit.mjs";

assert.ok(API_VERSION >= 27, "Dev needs the fork with API 27 (korg.menu.group, korg.menu.text, korg.menu.value, korg.read.ram)");
const { SCRIPT_ENTRY, EVENTS, TIMER3, BUDGET, SCRIPT_MENU, LIMITS } = await import(pathToFileURL(join(fork, "data/script/contract.mjs")).href);

// what the plugin reads, as a device would hold it
const HEAP_TOP = 0xC06CC000, RUNTIME = 0xC01AE000, MENU = 0xC01D6E00, META = 0xC036AD88;
// the firmware's power and battery models, found through their pointers (upstream's measurement 2026-11-11-plugin-api34-system.md,
// checked in the emulator 2026-11-13: +0x308 follows the adapter message both ways); the objects move from one start to the next
const POWER_PTR = 0xC03405C4, BATTERY_PTR = 0xC03405C8, POWER_AT = 0xC06C2E98, BATTERY_AT = 0xC06C3218;
const text = (s, at) => { let w = 0; for (let i = 3; i >= 0; i--) w = w * 256 + (s.charCodeAt(at + i) || 0); return w; };
function device({ adapter = 1, level = 3, models = true, card = 31116288, version = "BLECH 1.4.5", samples = { 18: 15866, 500: 629884, 998: 96000 * 3 }, scan = true } = {}) {
  const d = boot("Dev"), ram = d.hardware.ram;
  ram.set(0xC06C90A0, adapter ? 0 : 1);                 // the old guess, which does not follow the adapter: not read
  if (models) { ram.set(POWER_PTR, POWER_AT); ram.set(BATTERY_PTR, BATTERY_AT); }
  ram.set(POWER_AT + 0x308, adapter);
  ram.set(BATTERY_AT + 0x328, level);
  ram.set(0xC03404AC, HEAP_TOP);
  ram.set(0xC031BEA0, card);
  for (let at = 0; at < 16; at += 4) ram.set(0xC014FCF0 + at, text(version.padEnd(16, "\0"), at));
  ram.set(0xC03404A8, 0x96);
  // two plugins in the runtime's list: their longest frames took 150000 and 75000 ticks, 1 ms and 0.5 ms of the 5 ms
  ram.set(RUNTIME, 0xC01D7000); ram.set(0xC01D7000, 0xC01D8000); ram.set(0xC01D8000, 0);
  ram.set(0xC01D7000 + 144, 150000); ram.set(0xC01D8000 + 144, 75000);
  ram.set(MENU + 40, 5); ram.set(MENU + 60, 21);
  ram.set(0xC06A292C, 61 * 60000 + 59999);
  for (const [index, bytes] of Object.entries(samples)) ram.set(META + index * 0x45C + 4, bytes);
  assert.deepEqual(d.run(scan ? 140 : 14), []);
  return d;
}
const pages = d => Object.fromEntries(d.menus.map(m => [m.label, m.text || m.value]));

// the offsets the plugin carries are those of the fork's contract
assert.equal(SCRIPT_ENTRY.fields.find(f => f.name === "maxEventTicks").offset + 4 * EVENTS.find(e => e.name === "frame").id, 144);
assert.equal(SCRIPT_ENTRY.fields.find(f => f.name === "next").offset, 0);
assert.equal(TIMER3.hz / 1000 * BUDGET.frameMs / 100, 7500, "ticks of a percent of the frame budget");

{
  const d = device();
  assert.ok(d.menus.length >= 13 && d.menus.length <= SCRIPT_MENU.pages);
  assert.ok(d.menus.every(m => m.group === "DEV" && m.script === "Dev"), "every page sits in DEV");
  assert.ok(d.menus.every(m => m.label.length <= LIMITS.nameLength));
  assert.deepEqual(pages(d), {
    "POWER": "ADAPTER",
    "BATTERY": "3/4",
    "HEAP FREE KB": (0xC08A2940 - HEAP_TOP) >> 10,
    "HEAP USED KB": (HEAP_TOP - 0xC06A2940) >> 10,
    "SAMPLE USED S": Math.trunc((15866 + 629884 + 96000 * 3) / 96000),
    "SAMPLE FREE S": 270 - Math.trunc((15866 + 629884 + 96000 * 3) / 96000),
    "SD CARD MB": Math.trunc(31116288 / 2048),
    "KORG VERSION": "2.02",
    "BLECH VERSION": 10405,
    "PANEL VERSION": 96,
    "PLUGIN PEAK %": 30,
    "PLUGINS": 5,
    "MENU PAGES": 21,
    "UPTIME MIN": 61,
  });
  // the values follow the RAM
  d.hardware.ram.set(POWER_AT + 0x308, 0);
  d.hardware.ram.set(BATTERY_AT + 0x328, 1);
  d.hardware.ram.set(0xC031BEA0, 0);
  d.hardware.ram.set(0xC03404AC, HEAP_TOP + 4096);
  assert.deepEqual(d.run(14), []);
  const now = pages(d);
  assert.deepEqual([now["POWER"], now["BATTERY"], now["SD CARD MB"], now["HEAP USED KB"]], ["BATTERY", "1/4 NIEDRIG", "NO CARD", ((HEAP_TOP - 0xC06A2940) >> 10) + 4]);
  for (const [level, shown] of [[4, "4/4"], [2, "2/4"], [0, "LEER"], [7, "?"]]) {
    d.hardware.ram.set(BATTERY_AT + 0x328, level);
    assert.deepEqual(d.run(14), []);
    assert.equal(pages(d)["BATTERY"], shown, `battery level ${level}`);
  }
  // the dial moves a page: the value read comes back with the next frame, nothing else changes
  const free = d.menus.find(m => m.label === "HEAP FREE KB");
  d.menuSet(free.id, free.value + 7);
  assert.deepEqual(d.run(1), []);
  assert.equal(d.menus.find(m => m.label === "HEAP FREE KB").value, free.value);
  // all plugins share 5 ms a frame: the plugin's own frame stays small
  const cost = d.status().scripts[0].maxCost.frame;
  assert.ok(cost < 1000, `the frame costs ${cost} of 20000 units at most`);
  console.log(`Dev: frame cost at most ${cost}`);
}
{
  // no model yet (pointer 0): no read outside RAM, which would stop the plugin, and both pages say they do not know
  const d = device({ models: false });
  assert.deepEqual([pages(d)["POWER"], pages(d)["BATTERY"]], ["?", "?"]);
}
{
  // before the first round over the sample slots the two pages say so; no card, no version text, a full memory
  const d = device({ scan: false, version: "\xff".repeat(16), samples: {} });
  assert.deepEqual([pages(d)["SAMPLE USED S"], pages(d)["SAMPLE FREE S"], pages(d)["BLECH VERSION"]], ["SCAN", "SCAN", 0]);
  const full = device({ samples: { 100: 96000 * 300 } });
  assert.deepEqual([pages(full)["SAMPLE USED S"], pages(full)["SAMPLE FREE S"]], [300, 0], "more than the 270 s shows no negative rest");
  assert.equal(pages(device({ version: "BLECH 1.10.12" }))["BLECH VERSION"], 11012);
}
console.log("Dev: tests ok");
