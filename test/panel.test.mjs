import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { BOTTOM_LEDS, BUTTONS, ENCODERS, KNOBS, PADS, TOUCH_BUTTON } from "../data/panel.mjs";
import { rgbLight } from "../site/app/led-trace.mjs";

const measured = evidence => {
  const m = /^measure:(\d{4}-\d{2}-\d{2})\/([a-z0-9-]+)$/.exec(evidence);
  return m && existsSync(new URL(`../docs/messungen/${m[1]}-${m[2]}.md`, import.meta.url));
};

const unique = (list, key) => assert.equal(new Set(list.map(c => c[key])).size, list.length, `${key} twice`);

test("every control has a measured number, used once", () => {
  for (const c of [...BUTTONS, ...ENCODERS, ...KNOBS, ...PADS]) {
    assert.equal(c.source, "measured", c.id);
    assert.ok(measured(c.evidence), `${c.id}: ${c.evidence}`);
  }
  for (const list of [BUTTONS, ENCODERS, KNOBS, PADS]) { unique(list, "index"); unique(list, "id"); }
  assert.ok(!BUTTONS.some(b => b.index === TOUCH_BUTTON), "the touch switch is not a button on the front");
});

test("every LED number says where it comes from", () => {
  for (const b of BUTTONS) {
    assert.ok(measured(b.ledEvidence) || b.ledEvidence === "derived:freetribe-svc-panel", `${b.id}: ${b.ledEvidence}`);
  }
  const all = [...BUTTONS.map(b => b.led), ...ENCODERS.map(e => e.led), ...PADS.flatMap(p => [p.ledRed, p.ledBlue])];
  assert.equal(new Set(all).size, all.length, "an LED belongs to one control");
});

test("the drawing places every button, encoder and knob of the table", () => {
  const drawing = readFileSync(new URL("../site/app/panel.mjs", import.meta.url), "utf8");
  for (const b of BUTTONS) assert.match(drawing, new RegExp(`button\\(B\\.${b.id}\\)`), `button ${b.id} missing`);
  for (const e of ENCODERS) assert.match(drawing, new RegExp(`(encoder|cutoff)\\(E\\.${e.id}\\)`), `encoder ${e.id} missing`);
  for (const k of KNOBS) assert.match(drawing, new RegExp(`knob\\(K\\.${k.id}[,)]`), `knob ${k.id} missing`);
  assert.match(drawing, /PADS\.map\(pad\)/);
});

test("the four LEDs under the case have three numbers each, 0x4c to 0x57, that no control uses", () => {
  assert.equal(BOTTOM_LEDS.length, 4);
  assert.deepEqual(BOTTOM_LEDS.flatMap(b => b.leds), Array.from({ length: 12 }, (_, i) => 0x4c + i), "red, green, blue of LED 1, then of LED 2 and so on");
  for (const b of BOTTOM_LEDS) assert.ok(measured(b.evidence), `${b.id}: ${b.evidence}`);
  const others = new Set([...BUTTONS.flatMap(b => [b.led, b.ledBlue]), ...ENCODERS.map(e => e.led), ...PADS.flatMap(p => [p.ledRed, p.ledBlue])]);
  for (const led of BOTTOM_LEDS.flatMap(b => b.leds)) assert.ok(!others.has(led), `LED ${led} belongs to a control`);
});

test("the drawing shows the four LEDs under the case", () => {
  const drawing = readFileSync(new URL("../site/app/panel.mjs", import.meta.url), "utf8");
  assert.match(drawing, /BOTTOM_LEDS\.map\(bottomLight\)/);
});

test("an RGB LED shows its hue at full strength and how bright it is; dark is no light", () => {
  assert.equal(rgbLight(0, 0, 0), null);
  assert.deepEqual(rgbLight(1, 0, 0), { color: "rgb(255 0 0)", strength: 1 });
  assert.deepEqual(rgbLight(0.5, 0.25, 0), { color: "rgb(255 128 0)", strength: 0.5 }, "a dim orange is a faint orange, not a brown");
  assert.deepEqual(rgbLight(0.2, 0.2, 0.2), { color: "rgb(255 255 255)", strength: 0.2 });
});
