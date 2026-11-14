import { test } from "node:test";
import assert from "node:assert/strict";
import { API_VERSION, API_BY_NAME, EVENTS, SCRIPT_MENU, SCRIPT_RAM } from "../data/script/contract.mjs";
import PROTECTED from "../data/protected.mjs";
import { asmInclude } from "../src/script/arm-tables.mjs";
import { compile, formatError } from "../src/script/compiler.mjs";
import { decodeBlob } from "../src/script/blob.mjs";
import { SimDevice } from "../src/script/sim.mjs";

const build = (name, source) => {
  const result = compile(source, { name });
  assert.ok(result.ok, result.errors?.map(formatError).join("\n"));
  return result.blob;
};
const run = (source, setup = () => {}, name = "api27") => {
  const sim = new SimDevice();
  setup(sim);
  const loaded = sim.load(build(name, source));
  assert.equal(loaded.error, null);
  sim.frame();
  return sim;
};
const vars = sim => Array.from(sim.runtime.scripts[0].script.vars);
const pages = sim => sim.menus.map(m => [m.label, m.group, m.text, m.value]);
const NAMES = ["korg.menu.group", "korg.menu.text", "korg.menu.value", "korg.read.ram"];

test("API 27 adds four calls at the end of the list, with their ranges and events", () => {
  assert.equal(API_VERSION, 27);
  assert.deepEqual(NAMES.map(n => API_BY_NAME.get(n).id), [115, 116, 117, 118]);
  for (const n of NAMES) assert.equal(API_BY_NAME.get(n).since, 27, n);
  const args = n => API_BY_NAME.get(n).args.map(a => [a.name, a.kind, a.min, a.max]);
  const last = SCRIPT_MENU.pages - 1;
  assert.deepEqual(args("korg.menu.group"), [["page", "int", -1, last], ["group", "str", undefined, undefined]]);
  assert.deepEqual(args("korg.menu.text"), [["page", "int", -1, last], ["text", "str", undefined, undefined]]);
  assert.deepEqual(args("korg.menu.value"), [["page", "int", -1, last], ["value", "int", -2147483648, 2147483647]]);
  assert.deepEqual(args("korg.read.ram"), [["address", "int", 0xC0000000 | 0, 0xC7FFFFFC | 0]]);
  assert.equal(API_BY_NAME.get("korg.menu.group").eventMask, API_BY_NAME.get("korg.menu.add").eventMask, "a page is put into its group where it is added");
  const everywhere = EVENTS.reduce((m, e) => m | (1 << e.id), 0) >>> 0;
  const notInSave = (everywhere & ~(1 << EVENTS.find(e => e.name === "save").id)) >>> 0;
  assert.equal(API_BY_NAME.get("korg.menu.text").eventMask, notInSave);
  assert.equal(API_BY_NAME.get("korg.menu.value").eventMask, notInSave);
  assert.equal(API_BY_NAME.get("korg.read.ram").eventMask, everywhere);
  assert.deepEqual(NAMES.filter(n => API_BY_NAME.get(n).returns === "int"), ["korg.read.ram"]);
  const equ = Object.fromEntries([...asmInclude().matchAll(/^\.equ (\w+), (\w+)$/gm)].map(m => [m[1], Number(m[2])]));
  assert.deepEqual([equ.API_KORG_MENU_GROUP, equ.API_KORG_MENU_TEXT, equ.API_KORG_MENU_VALUE, equ.API_KORG_READ_RAM], [115, 116, 117, 118]);
  assert.deepEqual([equ.SCRIPT_MENU_PAGES, equ.SCRIPT_MENU_GROUP_FEATURES, equ.SCRIPT_MENU_GROUP_CUSTOMIZATION, equ.SCRIPT_MENU_GROUP_DEV], [SCRIPT_MENU.pages, 1, 2, 3]);
});

test("the menu holds at least 40 pages and korg.read.ram reaches exactly the window BLECH's SysEx READ reads", () => {
  assert.ok(SCRIPT_MENU.pages >= 40);
  assert.deepEqual(SCRIPT_MENU.groups, ["FEATURES", "CUSTOMIZATION", "DEV"]);
  const { start, end } = PROTECTED.ram.window;
  assert.deepEqual([SCRIPT_RAM.first, SCRIPT_RAM.last], [start, end - 4], "a whole word inside the window");
  // READ refuses the regions with deny "any" (a port, the loader copy): none of them may lie in the window, or korg.read.ram would reach it
  const refused = PROTECTED.regions.filter(r => r.space === "ram" && r.deny === "any" && r.start < end && r.end > start);
  assert.deepEqual(refused, []);
});

test("a block needs API 27 only when it uses one of the new calls, and a block of API 26 still loads and runs", () => {
  const version = source => decodeBlob(build("v", source)).header.apiVersion;
  for (const call of [`korg.menu.text(0, "ON");`, "korg.menu.value(0, 3);", "let w = korg.read.ram(0xC03404AC);"]) {
    assert.equal(version(`korg.onEvent("frame", () => { ${call} });`), 27, call);
  }
  assert.equal(version(`let p = korg.menu.add("X", 0, 1, 0); korg.menu.group(p, "DEV");`), 27);
  const old = `let p = korg.menu.add("OLD", 0, 9, 4); let seen = 0; let frames = korg.read.sampleFrames(500);
    korg.onEvent("menu", (id, value) => { if (id == p) seen = value; });`;
  assert.equal(version(old), 26);
  const sim = run(old, s => s.hardware.samples.set(500, { frames: 123, rate: 48000, tune: 0 }), "old");
  sim.menuSet(0, 7);
  sim.frame();
  assert.deepEqual(vars(sim).slice(0, 3), [0, 7, 123]);
  assert.deepEqual(sim.menus, [{ id: 0, script: "old", label: "OLD", min: 0, max: 9, value: 7, group: null, text: "" }]);
  assert.equal(compile(`korg.onEvent("frame", () => { korg.menu.group(0, "DEV"); });`, { name: "late" }).ok, false, "korg.menu.group is for the body and ready, like korg.menu.add");
});

test("korg.menu.group moves a page into FEATURES, CUSTOMIZATION or DEV, the dial still reaches the plugin", () => {
  const sim = run(`let a = korg.menu.add("A", 0, 9, 1); let b = korg.menu.add("B", 0, 9, 2); let c = korg.menu.add("C", 0, 9, 3); let d = korg.menu.add("D", 0, 9, 4);
    let seen = 0;
    korg.menu.group(a, "FEATURES"); korg.menu.group(b, "CUSTOMIZATION");
    korg.onEvent("ready", () => { korg.menu.group(c, "DEV"); });
    korg.onEvent("menu", (id, value) => { if (id == c) seen = value; });`);
  assert.deepEqual(pages(sim), [["A", "FEATURES", "", 1], ["B", "CUSTOMIZATION", "", 2], ["C", "DEV", "", 3], ["D", null, "", 4]]);
  assert.equal(sim.menuSet(2, 8), 8);
  sim.frame();
  assert.equal(vars(sim)[4], 8, "the plugin got menu for its page in DEV");
  const bad = run(`let p = korg.menu.add("A", 0, 9, 1); korg.onEvent("ready", () => { korg.menu.group(p, "GAMES"); });`);
  assert.equal(bad.runtime.scripts[0].script.fault?.name, "API_ARG", "a group that is none of the three");
  assert.deepEqual(pages(bad), [["A", null, "", 1]]);
});

test("korg.menu.text shows a text in place of the number until the empty text, korg.menu.value sets the number without an event", () => {
  const sim = run(`let p = korg.menu.add("MODE", 0, 4, 1); let events = 0;
    korg.menu.text(p, "FADE");
    korg.onEvent("menu", (id, value) => { events = events + 1; if (value == 0) korg.menu.text(id, "OFF"); if (value == 2) korg.menu.text(id, "A TEXT OF 20 LETTERS"); if (value == 3) korg.menu.text(id, ""); });
    korg.onEvent("buttonPress", (k) => { korg.menu.value(p, k); });`);
  assert.deepEqual(pages(sim), [["MODE", null, "FADE", 1]]);
  sim.menuSet(0, 0); sim.frame();
  assert.deepEqual(pages(sim), [["MODE", null, "OFF", 0]]);
  sim.menuSet(0, 2); sim.frame();
  assert.deepEqual(pages(sim), [["MODE", null, "A TEXT OF 20 LE", 2]], `cut to ${SCRIPT_MENU.textLength} characters`);
  sim.menuSet(0, 3); sim.frame();
  assert.deepEqual(pages(sim), [["MODE", null, "", 3]], "the empty text brings the number back");
  const before = vars(sim)[1];
  sim.post("buttonPress", 4); sim.frame();
  assert.deepEqual(pages(sim), [["MODE", null, "", 4]]);
  sim.post("buttonPress", 9); sim.frame();
  assert.deepEqual(pages(sim), [["MODE", null, "", 4]], "clamped to the page's range");
  assert.equal(vars(sim)[1], before, "korg.menu.value sends no menu event");
});

test("a page that is not the plugin's own is left alone: -1, a page not added, another plugin's", () => {
  const sim = new SimDevice();
  assert.equal(sim.load(build("owner", `let p = korg.menu.add("MINE", 0, 9, 5); korg.menu.text(p, "KEEP");`)).error, null);
  assert.equal(sim.load(build("other", `korg.menu.group(0, "DEV"); korg.menu.text(0, "TAKEN"); korg.menu.value(0, 1);
    korg.menu.group(-1, "DEV"); korg.menu.text(-1, "X"); korg.menu.value(-1, 1); korg.menu.text(7, "X"); korg.menu.value(7, 1);
    let page = ${SCRIPT_MENU.pages};
    korg.onEvent("buttonPress", (k) => { korg.menu.text(page, "X"); });`)).error, null);
  sim.frame();
  assert.deepEqual(pages(sim), [["MINE", null, "KEEP", 5]]);
  assert.equal(sim.runtime.scripts[1].script.state, "armed");
  sim.post("buttonPress", 1); sim.frame();
  assert.equal(sim.runtime.scripts[1].script.fault?.name, "API_ARG", "a page number the table never has");
});

test(`the menu holds ${SCRIPT_MENU.pages} pages for all plugins together`, () => {
  // a block has 64 texts at most, so the pages come from three plugins: 30, 30 and the rest plus two that find no place
  const n = SCRIPT_MENU.pages;
  const sim = new SimDevice();
  const adds = (count, tail = "") => Array.from({ length: count }, (_, i) => `let p${i} = korg.menu.add("page${i}", 0, 9, 0);`).join("\n") + tail;
  for (const name of ["one", "two"]) assert.equal(sim.load(build(name, adds(30))).error, null);
  const rest = n - 60;
  assert.equal(sim.load(build("three", adds(rest + 2, `\nkorg.menu.group(p${rest - 1}, "DEV");`))).error, null);
  assert.equal(sim.menus.length, n);
  assert.deepEqual(Array.from(sim.runtime.scripts[2].script.vars).slice(rest - 1, rest + 2), [n - 1, -1, -1]);
  assert.equal(sim.menus[n - 1].group, "DEV");
});

test("korg.read.ram reads the word a test put at the address, 0 elsewhere, and refuses an address outside the RAM window", () => {
  const sim = run(`let a = 0; let b = 0; let c = 0; let d = 0;
    korg.onEvent("ready", () => { a = korg.read.ram(0xC03404AC); b = korg.read.ram(0xC0000000); c = korg.read.ram(0xC7FFFFFC); d = korg.read.ram(0xC0691518); });`, s => {
    s.hardware.ram.set(0xC03404AC, 0xC06B0000);
    s.hardware.ram.set(0xC7FFFFFC, 77);
  });
  assert.deepEqual(vars(sim).slice(0, 4), [0xC06B0000 | 0, 0, 77, 0]);
  for (const address of ["0xBFFFFFFC", "0xC7FFFFFD", "0xC8000000", "0x01E26098", "0x60000000", "0", "0xFFFF0000"]) {
    const bad = run(`let at = ${address}; let a = 0; korg.onEvent("ready", () => { a = korg.read.ram(at); });`);
    assert.equal(bad.runtime.scripts[0].script.fault?.name, "API_ARG", address);
  }
});
