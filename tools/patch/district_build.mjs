#!/usr/bin/env node
/**
 * Builds DISTRICT from Korg's SYSTEM.VSB: the set data/patches/blech.json, as apply.mjs applies it, and prints the check to run.
 * The line under BLECH -> VERSION names the fork "DISTRICT", as the tracked data/patches/script-runtime*.json carry it. A
 * private build names it otherwise: DISTRICT_NAME, else the first line of district-name.local in the repository root (gitignored,
 * never tracked). Then the runtime patches of the set are built anew with that name into a temporary folder and take the place
 * of the tracked ones; nothing tracked changes.
 *
 *   node tools/patch/district_build.mjs --vsb SYSTEM.VSB --out NEW.VSB
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildRuntimePatch } from "./script_runtime.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const local = join(root, "district-name.local");
const name = process.env.DISTRICT_NAME || (existsSync(local) ? readFileSync(local, "utf8").split("\n")[0].trim() : "");
const RUNTIME = { "data/patches/script-runtime.json": "hacktribe", "data/patches/script-runtime-stock.json": "stock" };
const tmp = mkdtempSync(join(tmpdir(), "district-"));
process.env.DISTRICT_NAME = name;
const patches = JSON.parse(readFileSync(join(root, "data/patches/blech.json"), "utf8")).patches.map(p => {
  if (!name || !RUNTIME[p]) return join(root, p);
  const out = join(tmp, basename(p));
  writeFileSync(out, buildRuntimePatch(RUNTIME[p]));
  return out;
});
const run = spawnSync(process.execPath, [join(root, "tools/patch/apply.mjs"), ...process.argv.slice(2), ...patches.flatMap(p => ["--patch", p])],
  { stdio: "inherit" });
rmSync(tmp, { recursive: true, force: true });
process.exit(run.status ?? 1);
