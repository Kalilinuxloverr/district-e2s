// MELODY: SHIFT + PART ERASE writes a Hardtekk line or an offbeat bass into the selected part (docs/hardtekk-melodie.md).
// The checks are what a listener would notice, over many seeds; the form, progression and template of a line are not read
// from the plugin, they are found again in the steps it wrote.
// Run: DISTRICT_DIR=out/district-api26 node plugins/api26/Melodie.test.mjs
import assert from "node:assert/strict";
import { build, source, probe, SimDevice, key } from "../../tools/plugins/sim-kit.mjs";

const blob = build("Melodie");
const SHIFT = key("SHIFT"), ERASE = key("PART_ERASE");
const RANDOM = 0, HARDTEKK = 1, BASS = 2;

// ---------------------------------------------------------------- the rules, as the test knows them
// The 35 scales of the device (Parameter Guide, Scale List), as semitones above the key.
const SCALES = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], [0, 2, 4, 5, 7, 9, 11], [0, 2, 3, 5, 7, 9, 10], [0, 1, 3, 5, 7, 8, 10], [0, 2, 4, 6, 7, 9, 11],
  [0, 2, 4, 5, 7, 9, 10], [0, 2, 3, 5, 7, 8, 10], [0, 1, 3, 5, 6, 8, 10], [0, 2, 3, 5, 7, 8, 11], [0, 2, 3, 5, 7, 9, 11],
  [0, 2, 3, 4, 7, 9], [0, 3, 5, 6, 7, 10], [0, 2, 3, 5, 6, 8, 9, 11], [0, 1, 3, 4, 6, 7, 9, 10], [0, 2, 4, 7, 9], [0, 3, 5, 7, 10],
  [0, 1, 4, 5, 7, 8, 11], [0, 1, 4, 6, 7, 9, 11], [0, 1, 3, 6, 7, 8, 11], [0, 2, 4, 5, 6, 8, 10], [0, 1, 3, 4, 5, 7, 8, 10],
  [0, 2, 3, 6, 7, 8, 11], [0, 2, 5, 7, 10], [0, 2, 3, 7, 9], [0, 1, 3, 7, 8], [0, 1, 5, 7, 8], [0, 4, 5, 7, 11], [0, 4, 6, 7, 11],
  [0, 7, 10], [0, 2, 4, 6, 8, 10], [0, 3, 6, 9], [0, 4, 8], [0, 5, 10], [0, 7], [0],
];
const AEOLIAN = 6, PHRYGIAN = 3, CHROMATIC = 0;
const MINOR = SCALES[AEOLIAN];
// rule 2
const TEMPLATES = ["..x...x...x...x.", "x.x.x.x.x.x.x.x.", "x..x..x.x..x..x.", "x..x..x..x..x.x.", "x.xxx.xxx.xxx.xx", "xxx.xxx.xxx.xxx.",
  ".xxx.xxx.xxx.xxx", "..xx..xx..xx..xx", "x.x.x..x..x.x...", "x.xx..x.x.xx....", "x..x..x...x.x...", "xxxxxxxxxxxxxxxx"]
  .map(t => [...t].flatMap((c, i) => (c === "x" ? [i] : [])));
// rule 3
const PROGS = [[1, 1, 1, 1], [1, 6, 3, 7], [1, 1, 6, 7], [1, 7, 6, 5], [1, 4, 6, 7], [1, 6, 7, 1], [1, 2, 1, 2]];
// steps a beat for BEAT 16, 32, 8 Tri, 16 Tri and BLECHTRIBE's 8
const SPB = [4, 8, 3, 6, 2];
const mod = (a, n) => ((a % n) + n) % n;

/** The scale a line is made of: the pattern's own, natural minor when the pattern says Chromatic. */
const working = scale => (scale === CHROMATIC ? MINOR : SCALES[scale]);
/** The pitch class of the scale nearest to `semi` above the key, the upper one when two are as near. */
function near(list, semi) {
  let best = 0, bd = 99;
  for (const v of [...list, 12]) { const d = Math.abs(v - mod(semi, 12)); if (d <= bd) { bd = d; best = v; } }
  return mod(best, 12);
}
/** Root, fifth and third (pitch classes above the key) of the chord on degree 1 to 7. */
function chord(list, degree) {
  const n = list.length;
  if (n === 7) return [0, 4, 2].map(k => list[mod(degree - 1 + k, 7)]);
  const root = near(list, MINOR[degree - 1]);
  return [root, near(list, root + 7), near(list, root + 3)];
}
/** What the part plays: `played` steps of each bar of 16, `total` in the pattern, `bar` steps to a musical bar of four beats. */
function grid({ len, beat, last }) {
  const played = Math.min(last || 16, beat === 2 || beat === 3 ? 12 : 16);
  const spb = SPB[beat], bar = 4 * spb, total = len * played;
  return { played, spb, bar, total, bars: Math.ceil(total / bar) };
}
const stepOf = (g, q) => Math.floor(q / g.played) * 16 + (q % g.played);

// ---------------------------------------------------------------- a device with a pattern
const MARK = [1, 0x33, 0x44, 1, 0x30, 0x31, 0, 0, 0xE1, 0xE2, 0xE3, 0xE4];
const DEFAULTS = { kind: HARDTEKK, seed: 1, len: 4, beat: 0, keyNote: 0, scale: AEOLIAN, last: 0, part: 3, pattern: 7, blob };

/** A device whose pattern is full of marked steps in all 16 parts; the store hands the plugin its start seed. */
function device(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const saves = [];
  const d = new SimDevice({ storage: { load: () => ({ mask: 2, values: [0, cfg.seed] }), save: r => saves.push(r) } });
  const loaded = d.load(cfg.blob);
  assert.ok(loaded.ok, JSON.stringify(loaded.error));
  const hw = d.hardware, block = hw.patternBlock(-1);
  block[37] = cfg.len - 1; block[38] = cfg.beat; block[39] = cfg.keyNote; block[40] = cfg.scale;
  for (let p = 0; p < 16; p++) for (let s = 0; s < 64; s++) block.set(MARK, hw.stepAt(p, s));
  block[0x800 + cfg.part * 0x330] = cfg.last;
  hw.part = cfg.part; hw.pattern = cfg.pattern;
  // the firmware behind the input filter: BLECHTRIBE's dice rolls when PART ERASE reaches it while SHIFT is down
  const fw = { keys: [], dice: 0, shift: 0, scribble: false };
  const input = hw.input.bind(hw), firmwareKey = hw.firmwareKey.bind(hw);
  hw.input = (event, ...args) => {
    if (args[0] === SHIFT && event === "buttonPress") fw.shift = 1;
    if (args[0] === SHIFT && event === "buttonRelease") fw.shift = 0;
    return input(event, ...args);
  };
  hw.firmwareKey = k => {
    fw.keys.push(k);
    if (k === ERASE && fw.shift) {
      fw.dice += 1;
      if (fw.scribble) for (let s = 0; s < 64; s++) { hw.setStep(hw.part, s, 99, 1); hw.patternBlock(-1)[hw.stepAt(hw.part, s) + 1] = 127; }
    }
    firmwareKey(k);
  };
  // the cost of all handlers of one frame together
  const entry = d.runtime.scripts[0], dispatch = entry.script.dispatch.bind(entry.script);
  const meter = { frame: 0, costs: [], wrote: [] };
  entry.script.dispatch = (...a) => { const r = dispatch(...a); meter.frame += r.cost; return r; };
  if (cfg.kind !== HARDTEKK) d.menuSet(d.menus.find(m => m.label === "MELODY").id, cfg.kind);
  return { d, hw, cfg, fw, saves, meter, before: null };
}

/** Runs `frames` frames; `inputs` are [frame, "press" | "release", key name] counted from now. Keeps each frame's cost and the frames that changed a step. */
function play(dev, frames, inputs = []) {
  const { d, hw, meter } = dev, start = d.frames, faults = [];
  const steps = () => hw.patternBlock(-1).slice(0x800, 0x800 + 16 * 0x330).join();
  let was = steps();
  for (let f = 0; f < frames; f++) {
    for (const [at, what, name] of inputs) if (at === f) d.post(what === "press" ? "buttonPress" : "buttonRelease", key(name));
    meter.frame = 0;
    faults.push(...d.frame().faults);
    meter.costs.push(meter.frame);
    const now = steps();
    if (now !== was) meter.wrote.push(d.frames - 1);
    was = now;
  }
  assert.deepEqual(faults, [], `faults from frame ${start}`);
  return dev;
}
const COMBO = [[1, "press", "SHIFT"], [3, "press", "PART_ERASE"], [5, "release", "PART_ERASE"], [7, "release", "SHIFT"]];
/** The frame PART ERASE comes down in a roll() and the first frame after it in which nothing is pressed or let go any more. */
const PRESSED = 5, QUIET = 10;
/** Over all lines of this file: the dearest frame, the dearest frame at rest after a line, the frames from the press to a line's last step. */
const worst = { cost: 0, rest: 0, frames: 0, lines: 0 };
/** SHIFT + PART ERASE as a hand presses it, and time enough for the line. */
function roll(options) {
  const dev = device(options);
  play(dev, 2);
  dev.before = Uint8Array.from(dev.hw.patternBlock(-1));
  play(dev, 40, COMBO);
  const done = dev.meter.wrote.at(-1) ?? PRESSED - 1;
  worst.lines += 1;
  worst.cost = Math.max(worst.cost, ...dev.meter.costs);
  worst.frames = Math.max(worst.frames, done - PRESSED + 1);
  worst.rest = Math.max(worst.rest, ...dev.meter.costs.slice(Math.max(done + 1, QUIET)));
  return dev;
}

/** The notes the part plays, in the order of its steps: slot (counted over the played steps), note, length in steps, gate, velocity. */
function notes(dev, part = dev.cfg.part) {
  const g = grid(dev.cfg), out = [];
  let tied = false;
  for (let q = 0; q < g.total; q++) {
    if (q % g.played === 0) tied = false;
    const v = dev.hw.stepValue(part, stepOf(g, q)), prev = out.at(-1);
    if (!v.on) { tied = false; continue; }
    if (tied && v.trigger === 0 && v.note === prev.note) { prev.length += 1; prev.gate = v.gate; }
    else out.push({ slot: q, note: v.note, length: 1, gate: v.gate, velocity: v.velocity });
    tied = v.gate > 96;
  }
  return out;
}
/** Where a note sits in the working scale: octaves times the scale's size plus its place, or null outside the scale. */
function place(cfg, note) {
  const list = working(cfg.scale), rel = note - 48 - cfg.keyNote, at = list.indexOf(mod(rel, 12));
  return at < 0 ? null : Math.floor(rel / 12) * list.length + at;
}
const pc = (cfg, note) => mod(note - 48 - cfg.keyNote, 12);
/** The notes of musical bar `b`, with their slot counted from the bar's start. */
const barNotes = (dev, all, b) => { const g = grid(dev.cfg); return all.filter(n => Math.floor(n.slot / g.bar) === b).map(n => ({ ...n, at: n.slot - b * g.bar })); };
/** The progressions (rule 3) the bars can stand on: every note on a kick step is root or fifth of its bar's chord, the first note of a bar may be the third. */
function progressions(dev, all) {
  const g = grid(dev.cfg), list = working(dev.cfg.scale);
  const rows = dev.cfg.scale === PHRYGIAN ? PROGS.slice(1) : PROGS.slice(0, 6);
  return rows.filter(row => {
    for (let b = 0; b < g.bars; b++) {
      const [root, fifth, third] = chord(list, row[b % 4]), bar = barNotes(dev, all, b);
      for (const [i, n] of bar.entries()) {
        const p = pc(dev.cfg, n.note);
        if (n.at % g.spb === 0 ? p !== root && p !== fifth : i === 0 && p !== root && p !== fifth && p !== third) return false;
      }
    }
    return true;
  });
}
/** The notes of bars `a` and `b` between two steps of the bar, in pairs; null when the rhythm differs. A pair says whether the note is stressed (on the kick, or the first of its bar) and how many places of the scale it moved. */
function paired(dev, all, a, b, from, to, lengths = false) {
  const g = grid(dev.cfg), cut = x => barNotes(dev, all, x).map((n, i) => ({ ...n, stressed: n.at % g.spb === 0 || i === 0 })).filter(n => n.at >= from && n.at < to);
  const x = cut(a), y = cut(b);
  if (x.length !== y.length || x.some((n, i) => n.at !== y[i].at || (lengths && n.length !== y[i].length))) return null;
  return x.map((n, i) => ({ stressed: n.stressed, move: place(dev.cfg, y[i].note) - place(dev.cfg, n.note) }));
}
const moves = (pairs, stressed) => [...new Set(pairs.filter(p => p.stressed === stressed).map(p => p.move))];
/** Whether a stretch of bar `b` is the same stretch of bar `a`, moved with the chord: the same rhythm, the stressed notes all moved by one interval of the scale, the others all by that interval or not at all. In a scale that has not seven tones only the rhythm is compared. */
function same(dev, all, a, b, from, to, lengths = false) {
  const pairs = paired(dev, all, a, b, from, to, lengths);
  if (!pairs) return false;
  if (working(dev.cfg.scale).length !== 7) return true;
  const hard = moves(pairs, true), soft = moves(pairs, false);
  return hard.length <= 1 && soft.length <= 1 && (!hard.length || !soft.length || soft[0] === 0 || soft[0] === hard[0]);
}
/** Rule 7, A': the second half of bar `b` is that of bar `a` moved with the chord, but for one or two notes off the kick that are a step away. */
function varied(dev, all, a, b, half, whole) {
  const head = paired(dev, all, a, b, 0, half), tail = paired(dev, all, a, b, half, whole, true);
  if (!head || !tail || moves(tail, true).length > 1) return false;
  const soft = tail.filter(p => !p.stressed).map(p => p.move);
  return [0, ...moves(head, false), ...moves(head, true), ...moves(tail, true)].some(usual => {
    const odd = soft.filter(m => m !== usual);
    return odd.length >= 1 && odd.length <= 2 && odd.every(m => Math.abs(m - usual) === 1);
  });
}
const xorshift = s => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; };
const seeds = (count, from = 1) => Array.from({ length: count }, (_, i) => (from + i) * 2654435761 | 0);

// ---------------------------------------------------------------- the page and the description
{
  const { d } = device();
  assert.deepEqual(d.menus.map(m => [m.label, m.min, m.max, m.value]), [["MELODY", 0, 2, 1]], "one page: 0 RANDOM, 1 HARDTEKK, 2 BASS; HARDTEKK as it comes");
  const text = source("Melodie").split("\n"), head = text.slice(0, text.findIndex(l => !l.startsWith("//")));
  for (const line of head) {
    assert.ok(line.length <= 23, `description line over 20 characters: ${line}`);
    assert.ok(/^[\x20-\x7e]*$/.test(line), `description line not ASCII: ${line}`);
  }
  for (const name of ["0 RANDOM", "1 HARDTEKK", "2 BASS"]) assert.ok(head.includes(`// ${name}`), `the value table names ${name}`);
  assert.ok(blob.length <= 32752, `block of ${blob.length} bytes`);
  // the builder's own probe (tools/plugins/build-district.mjs): 200 frames with EXIT + TAP, no fault
  const tap = [[5, "buttonPress", "EXIT"], [8, "buttonPress", "TAP"], [10, "buttonRelease", "TAP"], [12, "buttonRelease", "EXIT"]];
  const probed = probe(blob, tap.map(([frame, event, name]) => ({ frame, event, args: [key(name)] })), { minFrames: 200 });
  assert.ok(probed.ok, `the probe faults: ${JSON.stringify(probed.loadError ?? probed.faults)}`);
}

// ---------------------------------------------------------------- RANDOM: BLECHTRIBE's dice stays in charge
{
  const dev = roll({ kind: RANDOM });
  assert.deepEqual(dev.hw.patternBlock(-1), dev.before, "RANDOM writes nothing");
  assert.equal(dev.fw.dice, 1, "and PART ERASE reaches the firmware with SHIFT down: its dice rolls");
  assert.ok(Math.max(...dev.meter.costs.slice(QUIET)) <= 20 && Math.max(...dev.meter.costs.slice(3)) < 60, "RANDOM costs next to nothing");
}

// ---------------------------------------------------------------- the combination is the plugin's, the dice stays out
for (const kind of [HARDTEKK, BASS]) {
  const dev = device({ kind });
  play(dev, 6, [[1, "press", "SHIFT"], [3, "press", "PART_ERASE"]]);
  assert.equal(dev.hw.keyHold[ERASE], 1, "while SHIFT is down PART ERASE is kept from the firmware");
  play(dev, 40, [[1, "release", "PART_ERASE"], [3, "release", "SHIFT"]]);
  assert.deepEqual(dev.fw.keys, [SHIFT], "the firmware saw SHIFT and never PART ERASE");
  assert.equal(dev.fw.dice, 0, "so its dice did not roll");
  assert.ok(notes(dev).length > 0, "and the plugin wrote a line");
  assert.equal(dev.hw.keyHold[ERASE], 0, "PART ERASE goes back when SHIFT is let go");
  const blockAfter = Uint8Array.from(dev.hw.patternBlock(-1));
  play(dev, 20, [[1, "press", "PART_ERASE"], [4, "release", "PART_ERASE"]]);
  assert.deepEqual(dev.fw.keys, [SHIFT, ERASE], "PART ERASE alone is the firmware's key");
  assert.deepEqual(dev.hw.patternBlock(-1), blockAfter, "and writes nothing");
  assert.equal(dev.hw.quickSaves, 0, "nothing is saved");
  assert.equal(dev.saves.length, kind === HARDTEKK ? 0 : 1, "the card is written for the page MELODY only");
}
{
  // Both keys inside one frame (40 ms): the hold comes a frame too late, the firmware's dice rolls first. The plugin's line
  // then replaces every step the dice wrote, so what plays is the line of that seed and nothing of the dice.
  const calm = roll({ seed: 77 }), fast = device({ seed: 77 });
  fast.fw.scribble = true;
  play(fast, 2);
  play(fast, 40, [[1, "press", "SHIFT"], [1, "press", "PART_ERASE"], [5, "release", "PART_ERASE"], [7, "release", "SHIFT"]]);
  assert.equal(fast.fw.dice, 1, "inside one frame the dice does roll");
  assert.deepEqual(notes(fast), notes(calm), "but only the plugin's line is left");
}
{
  // SHIFT let go where the plugin cannot see it (the BLECH menu keeps inputs from plugins): after 10 s PART ERASE is the firmware's again.
  const dev = device();
  play(dev, 2);
  dev.before = Uint8Array.from(dev.hw.patternBlock(-1));
  play(dev, 260, [[1, "press", "SHIFT"]]);
  dev.fw.shift = 0;
  assert.equal(dev.hw.keyHold[ERASE], 0, "a SHIFT that never came back up is forgotten");
  play(dev, 20, [[1, "press", "PART_ERASE"], [3, "release", "PART_ERASE"]]);
  assert.deepEqual(dev.hw.patternBlock(-1), dev.before, "PART ERASE alone then writes nothing");
  assert.deepEqual(dev.fw.keys, [SHIFT, ERASE]);
}

// ---------------------------------------------------------------- the seed
{
  const a = notes(roll({ seed: 4711 })), b = notes(roll({ seed: 4711 })), c = notes(roll({ seed: 4712 }));
  assert.deepEqual(a, b, "the same seed gives the same steps");
  assert.notDeepEqual(a, c, "another seed another line");
  const twice = roll({ seed: 4711 });
  play(twice, 40, COMBO);
  assert.notDeepEqual(notes(twice), a, "each press gives a new line");
  assert.deepEqual(notes(twice), notes(roll({ seed: xorshift(4711) })), "the seed moves on by one xorshift a press");
  // without a stored seed the first press takes the time of the press
  const free = at => { const d = device({ seed: 0 }); play(d, at); return notes(play(d, 40, COMBO)); };
  assert.notDeepEqual(free(3), free(4), "no stored seed: the moment of the first press picks the line");
}

// ---------------------------------------------------------------- HARDTEKK, four bars of BEAT 16: the rules over many seeds
// The shares asserted at the end follow the weights of the plugin's table as they stand; when a weight is tuned, its share here moves with it.
{
  const stats = { templates: new Set(), progs: new Set(), turns: {}, loops: 0, lines: 0, heldLast: 0, bars: 0, two: 0, standing: 0, varied: 0, shift: 0, stay: 0 };
  const scales = [AEOLIAN, AEOLIAN, AEOLIAN, CHROMATIC, PHRYGIAN, 2, 8, 1];
  for (const [i, seed] of seeds(480).entries()) {
    const dev = roll({ seed, scale: scales[i % scales.length], keyNote: i % 12 });
    const { cfg } = dev, g = grid(cfg), all = notes(dev), list = working(cfg.scale), tag = `seed ${seed} scale ${cfg.scale}`;
    stats.lines += 1;
    // every note is in the pattern's key and scale (natural minor when the pattern is Chromatic), in the dice's range and playable
    for (const n of all) {
      assert.ok(place(cfg, n.note) !== null, `${tag}: note ${n.note} is not in the scale`);
      assert.ok(n.note >= 48 + cfg.keyNote - 12 && n.note <= 48 + cfg.keyNote + 36, `${tag}: note ${n.note} out of range`);
    }
    // rule 3 and 4: root or fifth of the bar's chord on every kick step, a chord tone as first note, one progression for the line
    const rows = progressions(dev, all);
    assert.ok(rows.length > 0, `${tag}: no progression fits the notes on the kick`);
    if (rows.includes(PROGS[0]) || (cfg.scale === PHRYGIAN && rows.includes(PROGS[6]))) stats.standing += 1;
    if (rows.length === 1) stats.progs.add(PROGS.indexOf(rows[0]));
    for (const n of all.filter(n => n.slot % 4 === 0 && n.slot < 16)) {
      assert.ok([list[0], list[4]].includes(pc(cfg, n.note)), `${tag}: bar 1 has ${n.note} on the kick, not root or fifth of the key`);
    }
    // rule 5: the motif stays inside an octave (from the sixth below the key), an octave jump goes one further
    const floor = 48 + cfg.keyNote + list[5] - 12;
    for (const n of all.filter(n => n.slot < 16)) assert.ok(n.note >= floor && n.note <= floor + 24, `${tag}: note ${n.note} of the motif is out of its range`);
    // the notes on the kick are the accents
    const accents = new Set(all.filter(n => n.slot % 4 === 0).map(n => n.velocity)), others = new Set(all.filter(n => n.slot % 4 !== 0).map(n => n.velocity));
    assert.ok(accents.size <= 1 && others.size <= 1 && (!accents.size || !others.size || [...accents][0] > [...others][0]), `${tag}: the notes on the kick are not the louder ones`);
    for (let b = 0; b < 4; b++) {
      const bar = barNotes(dev, all, b);
      // rule 5: at most five different notes in a bar
      assert.ok(new Set(bar.map(n => n.note)).size <= 5, `${tag}: bar ${b + 1} has more than five different notes`);
      assert.ok(bar.length > 0, `${tag}: bar ${b + 1} is empty`);
      // rule 6: a note never runs into the next, held notes are 2 to 4 steps (the turnaround's long note 8) and never cross the bar
      for (const [k, n] of bar.entries()) {
        const next = bar[k + 1]?.at ?? 16;
        assert.ok(n.at + n.length <= next, `${tag}: a note of bar ${b + 1} runs into the next`);
        assert.ok(n.gate >= 1 && n.gate <= 96, `${tag}: the last step of a note has no tie`);
        if (b === 0 && n.length === 1 && next - n.at === 1) assert.ok(n.gate <= 48, `${tag}: a 16th is short`);
        if (n.length === 1) assert.ok(n.gate < 96, `${tag}: an eighth is staccato`);
        if (n.length > 1) assert.ok((n.length >= 2 && n.length <= 4) || (n.at === 8 && n.length === 8), `${tag}: a held note of ${n.length} steps`);
        if (b === 0 && n.length > 1) assert.ok(k === bar.length - 1 || next - n.at > 3, `${tag}: held without a gap behind it`);
      }
    }
    // rule 2 and 10: bar 1 is one of the twelve templates, with 5 to 10 notes (thinned or filled when the template has more or fewer)
    const rhythm = barNotes(dev, all, 0).map(n => n.at);
    assert.ok(rhythm.length >= 5 && rhythm.length <= 10, `${tag}: ${rhythm.length} notes in the motif`);
    const fits = TEMPLATES.map((t, k) => ({ k, t })).filter(({ t }) => (t.length < 5 ? rhythm.length === 5 && t.every(s => rhythm.includes(s))
      : t.length > 10 ? rhythm.length === 10 && rhythm.every(s => t.includes(s)) && [0, 4, 8, 12].every(s => !t.includes(s) || rhythm.includes(s))
        : t.length === rhythm.length && t.every(s => rhythm.includes(s))));
    assert.ok(fits.length > 0, `${tag}: the rhythm ${rhythm} is none of the twelve templates`);
    stats.templates.add(fits.sort((x, y) => x.t.length - y.t.length)[0].k + 1);
    const last = barNotes(dev, all, 0).at(-1);
    stats.bars += 1; if (last.length > 1) stats.heldLast += 1;
    // rule 1 and 7: the motif is one bar (or two), and the first half of every later bar is the motif's first half again
    const period = [1, 2].find(p => [1, 2, 3].every(b => b < p || same(dev, all, b - p, b, 0, 8)));
    assert.ok(period, `${tag}: bars two to four do not start like the motif`);
    if (period === 2) stats.two += 1;
    assert.ok(period === 2 || (same(dev, all, 0, 1, 0, 8) && same(dev, all, 0, 2, 0, 8)), `${tag}: bars two and three resemble bar one`);
    // rule 7: in the first bar on another chord all notes move with the chord, or only the stressed ones
    for (const b of period === 1 ? [1, 2, 3] : []) {
      const pairs = paired(dev, all, 0, b, 0, 8), hard = moves(pairs, true), soft = moves(pairs, false);
      if (hard[0] && soft.length) { stats[soft[0] === 0 ? "stay" : "shift"] += 1; break; }
    }
    // rule 7: bar two is the motif again, the motif with its last one or two notes a step away (A'), or a turnaround
    if (period === 1 && !same(dev, all, 0, 1, 8, 16, true) && varied(dev, all, 0, 1, 8, 16)) stats.varied += 1;
    // rule 8: the last bar ends differently, unless the whole line is the loop AAAA
    const differs = !same(dev, all, 3 - period, 3, 8, 16, true);
    const loop = [1, 2, 3].every(b => b < period || same(dev, all, b - period, b, 0, 16, true));
    assert.ok(differs || loop, `${tag}: the last bar is the motif again, but the line is no plain loop`);
    if (loop) stats.loops += 1;
    // a turnaround (the bar ends unlike bar two and unlike bar three): a run between the kicks, one long note or a silent last beat,
    // and its last note in the second half is root or fifth of the bar's chord
    if (differs && !same(dev, all, 1, 3, 8, 16, true)) {
      const end = barNotes(dev, all, 3).filter(n => n.at >= 8);
      const turn = end.length === 1 && end[0].at === 8 && end[0].length === 8 ? "long" : end.every(n => n.at < 12) ? "silent"
        : end.length === 6 && end.every(n => n.at % 4 !== 0 && n.length === 1) ? "run" : "other";
      stats.turns[turn] = (stats.turns[turn] ?? 0) + 1;
      assert.notEqual(turn, "other", `${tag}: the last bar ends on ${end.map(n => n.at)}, which is no turnaround of rule 8`);
      if (rows.length === 1 && end.length) {
        const [root, fifth] = chord(list, rows[0][3]);
        assert.ok([root, fifth].includes(pc(cfg, end.at(-1).note)), `${tag}: the turnaround ends on ${end.at(-1).note}, not on root or fifth`);
      }
      if (turn === "run") assert.ok(new Set(end.map(n => n.note)).size <= 3, `${tag}: the run has more than three tones`);
    }
  }
  assert.deepEqual([...stats.templates].filter(k => k < 12).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "every template comes");
  assert.deepEqual([...stats.progs].sort(), [0, 1, 2, 3, 4, 5, 6], "every progression comes");
  const share = (n, of = stats.lines) => Math.round(100 * n / of);
  const turned = stats.turns.run + stats.turns.long + stats.turns.silent;
  assert.ok(share(stats.loops) >= 4 && share(stats.loops) <= 18, `AAAA about 10 %, got ${share(stats.loops)} %`);
  assert.ok(share(stats.two) >= 12 && share(stats.two) <= 38, `a motif of two bars about 25 %, got ${share(stats.two)} %`);
  assert.ok(share(stats.standing) >= 30, `the standing progression at least its 35 %, got ${share(stats.standing)} %`);
  assert.ok(share(stats.varied) >= 10 && share(stats.varied) <= 32, `A' as bar two in about 30 % of the one-bar motifs, got ${share(stats.varied)} % of all lines`);
  const moved = share(stats.shift, stats.shift + stats.stay);
  assert.ok(stats.shift + stats.stay > 100 && Math.abs(moved - 70) <= 12, `with the chord all notes move in about 70 %, got ${moved} % of ${stats.shift + stats.stay}`);
  assert.ok(share(stats.heldLast, stats.bars) >= 35 && share(stats.heldLast, stats.bars) <= 75, `the motif's last note held about 60 %, got ${share(stats.heldLast, stats.bars)} %`);
  for (const [turn, about] of [["run", 40], ["long", 35], ["silent", 25]]) {
    assert.ok(Math.abs(share(stats.turns[turn], turned) - about) <= 12, `turnaround ${turn} about ${about} %, got ${share(stats.turns[turn], turned)} %`);
  }
  console.log(`HARDTEKK: ${stats.lines} lines, AAAA ${share(stats.loops)} %, two-bar motif ${share(stats.two)} %, standing ${share(stats.standing)} %, A' ${share(stats.varied)} %, all notes move with the chord ${moved} %, `
    + `last note held ${share(stats.heldLast, stats.bars)} %, turnarounds run ${share(stats.turns.run, turned)} % long ${share(stats.turns.long, turned)} % silent ${share(stats.turns.silent, turned)} %`);
}

// ---------------------------------------------------------------- BASS: offbeats only, the root only
{
  let up = 0, bars = 0;
  for (const [i, seed] of seeds(160, 900).entries()) {
    const dev = roll({ kind: BASS, seed, scale: [AEOLIAN, CHROMATIC, PHRYGIAN, 15][i % 4], keyNote: i % 12 });
    const { cfg } = dev, all = notes(dev), list = working(cfg.scale), tag = `bass seed ${seed}`;
    const rows = (cfg.scale === PHRYGIAN ? PROGS.slice(1) : PROGS.slice(0, 6)).filter(row => [0, 1, 2, 3].every(b => barNotes(dev, all, b).every(n => pc(cfg, n.note) === chord(list, row[b])[0])));
    assert.ok(rows.length > 0, `${tag}: a bar plays something else than the root of its chord`);
    for (let b = 0; b < 4; b++) {
      const bar = barNotes(dev, all, b), rhythm = bar.map(n => n.at);
      assert.ok([TEMPLATES[0], TEMPLATES[7]].some(t => t.length === rhythm.length && t.every(s => rhythm.includes(s))), `${tag}: ${rhythm} is not template 1 or 8`);
      assert.ok(bar.every(n => n.at % 4 >= 2), `${tag}: a note off the offbeat`);
      assert.ok(bar.every(n => n.length === 1 && n.gate < 96), `${tag}: the gate is shorter than a step`);
      const low = Math.min(...bar.map(n => n.note));
      assert.ok(bar.every(n => n.note === low || (n.note === low + 12 && n.at >= 12)), `${tag}: only the last offbeat may be an octave up`);
      if (b === 0) assert.equal(low, 48 + cfg.keyNote, `${tag}: bar 1 is the key's root`);
      bars += 1; if (bar.some(n => n.note !== low)) up += 1;
    }
  }
  const share = Math.round(100 * up / bars);
  assert.ok(share >= 15 && share <= 35, `the last offbeat an octave up about 25 %, got ${share} %`);
  console.log(`BASS: ${bars} bars, last offbeat an octave up ${share} %`);
}

// ---------------------------------------------------------------- every length, BEAT and LAST STEP, both kinds
{
  let lines = 0;
  for (const kind of [HARDTEKK, BASS]) for (const beat of [0, 1, 2, 3, 4]) for (const len of [1, 2, 3, 4]) for (let last = 0; last < 16; last++) {
    for (const seed of seeds(2, 40 + beat * 7 + len + last * 3)) {
      const dev = roll({ kind, seed, beat, len, last, scale: [AEOLIAN, CHROMATIC, 15, 3][lines % 4], keyNote: lines % 12 });
      const { cfg, hw } = dev, g = grid(cfg), all = notes(dev), list = working(cfg.scale), tag = `kind ${kind} beat ${beat} len ${len} last ${last} seed ${seed}`;
      lines += 1;
      assert.ok(all.length > 0, `${tag}: nothing written`);
      for (const n of all) assert.ok(list.includes(pc(cfg, n.note)), `${tag}: note ${n.note} is not in the scale`);
      // only the steps the part plays, and only their first eight bytes; the other parts and everything else as it was
      const block = hw.patternBlock(-1);
      for (let at = 0; at < block.length; at++) {
        if (block[at] === dev.before[at]) continue;
        const inPart = at - 0x800 - cfg.part * 0x330 - 0x30, step = Math.floor(inPart / 12);
        assert.ok(inPart >= 0 && step < 64 && inPart % 12 < 8, `${tag}: byte ${at} outside the part's steps changed`);
        assert.ok(step % 16 < g.played && step >> 4 < cfg.len, `${tag}: step ${step + 1} is beyond LAST STEP or the length`);
      }
      // and every step it plays is the line's: no marked step is left sounding
      for (let q = 0; q < g.total; q++) {
        const v = hw.stepValue(cfg.part, stepOf(g, q));
        assert.ok(!v.on || v.velocity !== MARK[2], `${tag}: step ${stepOf(g, q) + 1} still plays what was there`);
        assert.ok(!v.on || v.gate <= 96 || (q + 1) % g.played !== 0, `${tag}: a tie on the last step of a bar`);
      }
      const rows = progressions(dev, all);
      if (kind === HARDTEKK) {
        assert.ok(rows.length > 0, `${tag}: no progression fits the notes on the kick`);
        for (let b = 0; b < g.bars; b++) assert.ok(new Set(barNotes(dev, all, b).map(n => n.note)).size <= 5, `${tag}: more than five different notes in bar ${b + 1}`);
        const whole = Math.floor(g.total / g.bar);
        const period = [1, 2].find(p => Array.from({ length: whole }, (_, b) => b).every(b => b < p || same(dev, all, b - p, b, 0, g.bar / 2)));
        assert.ok(period, `${tag}: the bars do not start like the motif`);
      } else {
        // a pattern that ends before its first offbeat (one or two steps in all) gets the root on its last step
        if (g.total > (g.spb + 1) >> 1) assert.ok(all.every(n => (n.slot % g.spb) * 2 >= g.spb), `${tag}: a bass note off the offbeat`);
        else assert.deepEqual(all.map(n => n.slot), [g.total - 1], `${tag}: one note on the last step`);
        for (let b = 0; b < g.bars; b++) assert.ok(new Set(barNotes(dev, all, b).map(n => mod(n.note, 12))).size <= 1, `${tag}: bar ${b + 1} is not one tone`);
        assert.ok(barNotes(dev, all, 0).every(n => pc(cfg, n.note) === 0), `${tag}: bar 1 is not the key's root`);
      }
      // in a pattern of whole bars the last bar ends differently, as in four bars of BEAT 16
      if (kind === HARDTEKK && list.length === 7 && g.bars > 1 && g.total % g.bar === 0) {
        const period = [1, 2].find(p => Array.from({ length: g.bars }, (_, b) => b).every(b => b < p || same(dev, all, b - p, b, 0, g.bar / 2)));
        const loop = Array.from({ length: g.bars }, (_, b) => b).every(b => b < period || same(dev, all, b - period, b, 0, g.bar, true));
        assert.ok(loop || !same(dev, all, g.bars - 1 - period, g.bars - 1, g.bar / 2, g.bar, true), `${tag}: the last bar is the motif again, but the line is no plain loop`);
      }
    }
  }
  console.log(`every length, BEAT and LAST STEP: ${lines} lines`);
}

// ---------------------------------------------------------------- all 35 scales
for (let scale = 0; scale < 35; scale++) for (const seed of seeds(6, 300 + scale)) {
  const dev = roll({ seed, scale, keyNote: scale % 12 }), all = notes(dev), tag = `scale ${scale} seed ${seed}`;
  assert.ok(all.length > 0, `${tag}: nothing written`);
  for (const n of all) assert.ok(SCALES[scale].includes(pc(dev.cfg, n.note)), `${tag}: note ${n.note} is not in the scale`);
  assert.ok(progressions(dev, all).length > 0, `${tag}: no progression fits the notes on the kick`);
  for (let b = 0; b < 4; b++) assert.ok(new Set(barNotes(dev, all, b).map(n => n.note)).size <= 5, `${tag}: more than five different notes in bar ${b + 1}`);
}

// ---------------------------------------------------------------- two presses never interleave, another pattern stops the line
{
  const lineOf = (seed, part) => notes(roll({ seed, part }), part);
  // the frames in which the first line's steps are written, and a frame of play() in the middle of them
  const first = roll({ seed: 31 }).meter.wrote, mid = first[first.length >> 1] - 2;
  assert.ok(first.length > 3 && first[0] - 2 < mid && mid < first.at(-1) - 2, "a line is written over several frames");
  const early = [[1, "press", "SHIFT"], [3, "press", "PART_ERASE"], [4, "release", "PART_ERASE"]];
  const again = [[mid, "press", "PART_ERASE"], [mid + 1, "release", "PART_ERASE"], [mid + 3, "release", "SHIFT"]];
  // a second press while the first line is being written: the first is written to its end, then the second replaces it whole
  const dev = device({ seed: 31 });
  play(dev, 2);
  play(dev, 80, [...early, ...again]);
  assert.deepEqual(dev.meter.wrote.slice(0, first.length), first, "the first line is written to its end, as without the second press");
  assert.ok(dev.meter.wrote.length > first.length, "then the second line is written");
  assert.deepEqual(notes(dev), lineOf(xorshift(31), 3), "and it is the whole line of the next seed");
  // the second press on another part: each part gets its own whole line
  const two = device({ seed: 31 });
  play(two, 2);
  play(two, mid, early);
  two.hw.part = 9;
  play(two, 80, again.map(([at, ...rest]) => [at - mid, ...rest]));
  assert.deepEqual(notes(two, 3), lineOf(31, 3), "the first part keeps its whole line");
  assert.deepEqual(notes(two, 9), lineOf(xorshift(31), 9), "the second part gets the next one");
  // another pattern comes into RAM while the line is written: nothing more is written
  const gone = device({ seed: 31 });
  play(gone, 2);
  play(gone, mid, [...early, [5, "release", "SHIFT"]]);
  const g = grid(gone.cfg), marked = () => Array.from({ length: g.total }, (_, q) => gone.hw.stepValue(3, stepOf(g, q))).filter(v => v.on && v.velocity === MARK[2]).length;
  assert.ok(marked() > 0 && marked() < g.total, "the line is under way");
  gone.hw.pattern = 8;
  const then = Uint8Array.from(gone.hw.patternBlock(-1));
  play(gone, 40);
  assert.deepEqual(gone.hw.patternBlock(-1), then, "a pattern change stops the line");
  // and the next press makes a whole line for what is in RAM now
  play(gone, 60, COMBO);
  assert.deepEqual(notes(gone), lineOf(xorshift(31), 3), "the next press writes a whole line again");
  // all 16 parts selected at once: nothing to write into
  const all = device();
  all.hw.part = 16;
  play(all, 2);
  const untouched = Uint8Array.from(all.hw.patternBlock(-1));
  play(all, 40, COMBO);
  assert.deepEqual(all.hw.patternBlock(-1), untouched, "no single part selected: nothing is written");
  // the display shows another pattern than the one in RAM (the wheel while playing): the line would go where nobody looks
  const viewing = device();
  viewing.hw.viewed = 9;
  play(viewing, 2);
  play(viewing, 40, COMBO);
  assert.deepEqual(viewing.hw.patternBlock(-1), untouched, "another pattern on the display: nothing is written");
  assert.equal(viewing.fw.dice, 0, "and the dice stays out all the same");
}

// ---------------------------------------------------------------- rule 5: range and contour, when five tones are not the limit
{
  // With MAX_TONES at 5 a motif cannot get far, and a tone over the limit is bent to one the motif has. Without the limit the
  // octave is what holds the motif, and the contour shows as it was drawn.
  const wide = build("Melodie", source("Melodie").replace("const MAX_TONES = 5;", "const MAX_TONES = 31;"));
  assert.notDeepEqual(wide, blob, "the table has MAX_TONES = 5");
  const seen = { most: 0, same: 0, step: 0, leap: 0, octave: 0, back: 0, soft: 0 };
  for (const seed of seeds(160, 700)) {
    const dev = roll({ seed, blob: wide }), floor = 48 + MINOR[5] - 12, motif = notes(dev).filter(n => n.slot < 16);
    for (const n of motif) assert.ok(n.note >= floor && n.note <= floor + 24, `seed ${seed}: note ${n.note} of the motif is out of its range`);
    seen.most = Math.max(seen.most, new Set(motif.map(n => n.note)).size);
    // the notes off the kick: where each went from the note before, and where the next went after an octave or a leap
    const placed = motif.map((n, k) => ({ soft: n.slot % 4 !== 0 && k > 0, place: place(dev.cfg, n.note) }));
    for (let k = 1; k < placed.length; k++) {
      const a = placed[k - 1], b = placed[k], c = placed[k + 1], move = b.place - a.place;
      if (!b.soft) continue;
      seen.soft += 1;
      if (move === 0) seen.same += 1;
      if (Math.abs(move) === 1) seen.step += 1;
      if (move === -7) seen.back += 1;
      if (move === 7) {
        seen.octave += 1;
        if (c?.soft) assert.equal(c.place, a.place, `seed ${seed}: after an octave jump the line does not come back`);
      }
      if (Math.abs(move) === 2 || Math.abs(move) === 3) {
        seen.leap += 1;
        assert.ok([0, 2, 4].includes(mod(b.place, 7)), `seed ${seed}: a leap lands off the chord`);
        if (c?.soft) assert.equal(c.place - b.place, -Math.sign(move), `seed ${seed}: after a leap no step back`);
      }
    }
  }
  const share = n => Math.round(100 * n / seen.soft);
  assert.ok(seen.most > 5, "the walk does use more than five tones when it may");
  assert.equal(seen.same + seen.step + seen.leap + seen.octave + seen.back, seen.soft, "every note off the kick repeats, steps, leaps a third or fourth, jumps an octave up or comes back from one");
  assert.ok(share(seen.same) >= 18 && share(seen.same) <= 42, `the same note again in about 35 % of the free moves, got ${share(seen.same)} % of all`);
  assert.ok(share(seen.step) >= 35 && share(seen.step) <= 65, `a step in about 40 % of the free moves and after every leap, got ${share(seen.step)} % of all`);
  assert.ok(share(seen.leap) >= 3 && share(seen.leap) <= 18, `a leap in about 15 % of the free moves where a chord tone is in reach, got ${share(seen.leap)} %`);
  assert.ok(share(seen.octave) >= 4 && share(seen.octave) <= 14, `an octave jump in about 10 % of the free moves, got ${share(seen.octave)} %`);
  console.log(`contour of ${seen.soft} notes off the kick: same ${share(seen.same)} %, step ${share(seen.step)} %, leap ${share(seen.leap)} %, octave ${share(seen.octave)} %`);
}

// ---------------------------------------------------------------- the cost of everything above
// the fork's own measure: 2630 units are about 0.5 ms, where it warns about a handler; all plugins together have 5 ms a frame
assert.ok(worst.cost <= 2630, `the dearest frame costs ${worst.cost} units`);
assert.ok(worst.rest <= 20, `a frame at rest costs ${worst.rest} units`);
assert.ok(worst.frames <= 25, `the longest line takes ${worst.frames} frames`);
console.log(`cost over ${worst.lines} lines: dearest frame ${worst.cost} units, a frame at rest ${worst.rest}, longest line ${worst.frames} frames from the press to its last step`);
console.log(`Melodie: tests ok, block ${blob.length} bytes`);
