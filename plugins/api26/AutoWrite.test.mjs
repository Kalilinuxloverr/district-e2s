// AUTO WRITE: an unsaved pattern is saved to its own place once the user has not touched the device for the chosen time.
// Run: DISTRICT_DIR=out/district-api26 node plugins/api26/AutoWrite.test.mjs
import assert from "node:assert/strict";
import { boot } from "../../tools/plugins/sim-kit.mjs";

const FRAME_MS = 40;
const touch = { frame: 10, event: "knob", args: [0, 99] };
/** A device with an unsaved pattern, the page AUTO WRITE on `value` (null: as it comes), one knob turn at frame 10. */
function device(value = null, { unsaved = 1, canSave = 1, touched = true } = {}) {
  const d = boot("AutoWrite"), hw = d.hardware;
  hw.unsaved = unsaved; hw.canSave = canSave;
  if (value !== null) d.menuSet(d.menus.find(m => m.label === "AUTO WRITE").id, value);
  const faults = d.run(11, touched ? [touch] : []);
  assert.deepEqual(faults, []);
  return d;
}
const after = (d, seconds) => { assert.deepEqual(d.run(Math.round(seconds * 1000 / FRAME_MS) - (d.frames - 10)), []); return d.hardware.quickSaves; };

{
  const d = boot("AutoWrite");
  assert.deepEqual(d.menus.map(m => [m.label, m.min, m.max, m.value]), [["AUTO WRITE", 0, 4, 1]], "one page, 2 s as it comes");
}
for (const [value, seconds] of [[null, 2], [1, 2], [2, 5], [3, 10], [4, 30]]) {
  const d = device(value);
  assert.equal(after(d, seconds - 0.3), 0, `value ${value}: nothing before ${seconds} s without a touch`);
  assert.equal(after(d, seconds + 0.3), 1, `value ${value}: saved after ${seconds} s`);
  assert.equal(after(d, seconds + 5), 1, "and only once");
}
assert.equal(after(device(0), 40), 0, "OFF never saves");
assert.equal(after(device(1, { unsaved: 0 }), 5), 0, "nothing unsaved, nothing written");
assert.equal(after(device(1, { touched: false }), 5), 0, "a difference nobody made on the panel is never written");
{
  const d = device(1, { canSave: 0 });
  assert.equal(after(d, 5), 0, "the firmware refuses (menu open, recording): nothing yet");
  d.hardware.canSave = 1;
  assert.equal(after(d, 5.3), 1, "saved as soon as the firmware allows it");
}
{
  const d = device(1);
  d.run(35, [{ frame: 40, event: "knob", args: [0, 50] }]);      // touched again at frame 40, 1.2 s after the first touch: the time starts over
  assert.equal(after(d, 2.9), 0, "a touch in between starts the time again");
  assert.equal(after(d, 3.6), 1);
}
console.log("AutoWrite: tests ok");
