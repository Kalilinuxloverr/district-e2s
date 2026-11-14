// AUTO BPM and EXIT: on the device a plugin that owns the display hears neither the press nor the release of EXIT
// (district/tools/patch/script_hooks.s, input_button). So the text of AUTO BPM must not take the display while EXIT is
// still down, else TAP stays held from the firmware after EXIT is let go and the next plain TAP toggles AUTO BPM
// instead of TAP MOTION. And a release that never comes (another plugin owned the display) must not keep TAP forever.
// Run: DISTRICT_DIR=out/district-api26 node plugins/api26/AutoBPM.test.mjs
import assert from "node:assert/strict";
import { boot, press, release, key, field } from "../../tools/plugins/sim-kit.mjs";

function device() {
  const d = boot("AutoBPM"), hw = d.hardware;
  hw.samples.set(20, { frames: 16941, rate: 48000, tune: 0 });
  hw.setPartValue(0, field("sample"), 20);
  hw.setStep(0, 0, 60, 100); hw.setStep(0, 4, 60, 100);
  return d;
}
const owner = d => d.runtime.open?.script?.name ?? null;

{
  const d = device();
  assert.deepEqual(d.run(12, [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP")]), []);
  assert.equal(d.hardware.tempo, 1700, "EXIT + TAP sets the tempo at once");
  assert.equal(owner(d), null, "but the text waits while EXIT is still down");
  assert.deepEqual(d.run(3, [release(d.frames + 1, "EXIT")]), []);
  assert.equal(owner(d), "AutoBPM", "the text comes when EXIT is let go");
  assert.equal(d.hardware.keyHold[key("TAP")], 0, "and TAP is the firmware's again");
  d.run(45);
  assert.equal(owner(d), null, "the text goes after 1.5 s");
}
{
  const d = device();
  d.run(12, [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP")]);
  assert.equal(d.hardware.keyHold[key("TAP")], 1, "TAP is held while EXIT is down");
  d.run(130);                                    // EXIT's release is never reported: 5.2 s
  assert.equal(d.hardware.keyHold[key("TAP")], 0, "after 5 s without a release TAP goes back to the firmware");
  assert.equal(owner(d), "AutoBPM", "and the text that waited is shown");
  const tempo = d.hardware.tempo;
  d.run(80, [press(d.frames + 50, "TAP"), release(d.frames + 52, "TAP")]);
  assert.equal(d.hardware.tempo, tempo, "a plain TAP afterwards does not toggle AUTO BPM");
}
// The tempo rules, as in tools/plugins/build-district.mjs: EXIT + TAP on part 0 with a sample on steps 0 and 4.
{
  const fit = (frames, sample = 20) => {
    const d = boot("AutoBPM"), hw = d.hardware;
    hw.samples.set(20, { frames, rate: 48000, tune: 0 });
    hw.setPartValue(0, field("sample"), sample);
    hw.setStep(0, 0, 60, 100); hw.setStep(0, 4, 60, 100);
    assert.deepEqual(d.run(80, [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP"), release(12, "EXIT")]), []);
    assert.equal(hw.keyHold[key("TAP")], 0, "TAP goes back to the firmware when EXIT is let go");
    return { tempo: hw.tempo, pitch: hw.patternValue(-1, 0, field("pitch")) };
  };
  assert.deepEqual(fit(16941), { tempo: 1700, pitch: 0 }, "0.353 s a beat is 170.0 BPM");
  assert.deepEqual(fit(24000), { tempo: 1511, pitch: 4 }, "0.5 s a beat is 120 BPM, pitch +4 brings 151.1");
  assert.deepEqual(fit(16941, 600), { tempo: 1200, pitch: 0 }, "an empty slot leaves the tempo alone");
  assert.deepEqual(fit(16941, 3), { tempo: 1200, pitch: 0 }, "an oscillator leaves the tempo alone");
  const plain = boot("AutoBPM");
  plain.hardware.samples.set(20, { frames: 16941, rate: 48000, tune: 0 });
  plain.hardware.setPartValue(0, field("sample"), 20);
  plain.hardware.setStep(0, 0, 60, 100);
  plain.run(80, [press(8, "TAP"), release(40, "TAP")]);
  assert.equal(plain.hardware.tempo, 1200, "TAP without EXIT is TAP MOTION's, not AUTO BPM's");
}
console.log("AutoBPM: tests ok");
