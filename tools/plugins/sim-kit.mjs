// What a plugin test needs from the fork: its compiler, its simulator and the names of keys and part fields.
// DISTRICT_DIR picks the copy of the fork (default district/), so tests can run against the frozen copy
// out/district-api26 while the fork itself is being changed.
//   import { boot, press, release, key, field, cost } from "../../tools/plugins/sim-kit.mjs";
import { readFileSync } from "node:fs";
import { join, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

export const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
const dir = process.env.DISTRICT_DIR || "district";
export const fork = isAbsolute(dir) ? dir : join(root, dir);
const v = p => import(pathToFileURL(join(fork, p)).href);
export const { compile, formatError } = await v("src/script/compiler.mjs");
export const { probe, SimDevice } = await v("src/script/sim.mjs");
export const { KEY_NAMES } = await v("data/script/names.mjs");
export const { PART_FIELDS, API_VERSION } = await v("data/script/contract.mjs");

export const key = n => KEY_NAMES.find(k => k.name === n).value;
export const field = n => PART_FIELDS.findIndex(f => f.name === n);
export const source = name => readFileSync(join(root, "plugins/api26", `${name}.js`), "utf8");

/** The compiled block of plugins/api26/<name>.js (or of `text`); a compile error is thrown with its line. */
export function build(name, text = source(name)) {
  const r = compile(text, { name });
  if (!r.ok) throw new Error(`${name}: ${formatError(r.errors[0])}`);
  return r.blob;
}

/** A simulated device with the plugin loaded and its start body run. */
export function boot(name, text) {
  const device = new SimDevice();
  const loaded = device.load(build(name, text));
  assert.ok(loaded.ok, `${name}: ${JSON.stringify(loaded.error)}`);
  return device;
}

export const press = (frame, k) => ({ frame, event: "buttonPress", args: [key(k)] });
export const release = (frame, k) => ({ frame, event: "buttonRelease", args: [key(k)] });
