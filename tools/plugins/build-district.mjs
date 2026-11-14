// Builds the plugins of the DISTRICT firmware from plugins/api26/*.js into out/plugins-district/: one .blech each and
// e2sPlugin.all, the collection the device loads at every start. First every plugin's own test (plugins/api26/<Name>.test.mjs)
// runs; a plugin without a test is not built. Then all plugins run together in the simulator, so the frame they share
// stays under the limit. Compiler and simulator come from the fork (DISTRICT_DIR, default district/).
// Usage: node tools/plugins/build-district.mjs
import { writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { root, fork, build, source, probe, SimDevice, press, release, API_VERSION } from "./sim-kit.mjs";
import { pathToFileURL } from "node:url";

const { packBlech, packAll } = await import(pathToFileURL(join(fork, "src/script/archive.mjs")).href);
const { markProbed } = await import(pathToFileURL(join(fork, "src/script/blob.mjs")).href);
assert.ok(API_VERSION >= 27, `${fork} is at API ${API_VERSION}, the plugins need 27 (menu groups and texts)`);

const src = join(root, "plugins/api26");
const names = readdirSync(src).filter(f => f.endsWith(".js")).map(f => basename(f, ".js")).sort();
for (const name of names) assert.ok(existsSync(join(src, `${name}.test.mjs`)), `${name} has no test (${name}.test.mjs), so it is not built`);
// Every test of the folder: one per plugin, and those of all plugins together (Seiten: the menu pages).
for (const test of readdirSync(src).filter(f => f.endsWith(".test.mjs")).sort()) {
  const run = spawnSync(process.execPath, [join(src, test)], { cwd: root, env: process.env, encoding: "utf8" });
  if (run.status !== 0) {
    process.stderr.write(run.stdout.slice(-3000) + run.stderr.slice(-3000));
    throw new Error(`${test} failed`);
  }
  console.log(`${test}: ${run.stdout.trim().split("\n").pop()}`);
}

// Every plugin alone: no fault over 200 frames with the keys the plugins react to.
const keys = [press(5, "EXIT"), press(8, "TAP"), release(10, "TAP"), release(12, "EXIT"), press(30, "PLAY"), press(150, "STOP")];
const blobs = {};
for (const name of names) {
  const blob = build(name);
  const p = probe(blob, keys, { minFrames: 200 });
  assert.ok(p.ok, `${name} faults in the simulator: ${JSON.stringify(p.loadError ?? p.faults)}`);
  blobs[name] = blob;
}

// All of them together, as the device loads them: no fault, and the dearest frame of all handlers together.
{
  const device = new SimDevice();
  for (const name of names) {
    const loaded = device.load(blobs[name]);
    assert.ok(loaded.ok, `${name} does not load next to the others: ${JSON.stringify(loaded.error)}`);
  }
  const faults = device.run(3000, [press(40, "PLAY"), press(2900, "STOP")]);
  assert.deepEqual(faults, [], "the plugins together fault in the simulator");
  console.log(`together: ${names.length} plugins, 3000 frames playing, no fault`);
}

const out = join(root, "release/plugins");
mkdirSync(out, { recursive: true });
// a .blech of a plugin that is gone from plugins/api26 must not reach the card (tools/karte-district.sh copies every .blech here)
for (const f of readdirSync(out)) if (f.endsWith(".blech") && !names.includes(basename(f, ".blech"))) rmSync(join(out, f));
const blocks = [];
for (const name of names) {
  const packed = packBlech(markProbed(blobs[name]), source(name));
  assert.ok(packed.ok, `${name}: ${packed.error?.message}`);
  writeFileSync(join(out, `${name}.blech`), packed.bytes);
  blocks.push(markProbed(blobs[name]));
  console.log(`${name}.blech  ${packed.bytes.length} bytes, block ${blobs[name].length}`);
}
const all = packAll(blocks);
assert.ok(all.ok, all.error?.message);
writeFileSync(join(out, "e2sPlugin.all"), all.bytes);
console.log(`e2sPlugin.all  ${all.bytes.length} bytes, ${blocks.length} plugins`);
