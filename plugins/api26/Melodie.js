// MELODIE: SHIFT +
// PART ERASE schreibt
// eine Linie in den
// gewaehlten Part, so
// lang wie das
// Pattern, in dessen
// Tonart und Scale.
// Jeder Druck gibt
// eine neue Linie.
//
// MELODY (Werte):
// 0 RANDOM
// 1 HARDTEKK
// 2 BASS
//
// RANDOM: BLECHTRIBE
// wuerfelt wie immer.
// HARDTEKK: ein Motiv
// von einem Takt,
// Grundton und Quinte
// auf der Kick, im
// letzten Takt ein
// Turnaround.
// BASS: Offbeat-Bass
// auf dem Grundton.
//
// Gespeichert wird
// nichts von selbst.

// The rules are docs/hardtekk-melodie.md, rule 1 to 10. They are inferred from hardstyle and get tuned by ear on the device,
// so every weight and template is in the table below and nowhere else. The block asks for API 24 (a part's LAST STEP).

// ======================================================================================================================
// THE TABLE: everything to tune by ear
// ======================================================================================================================
// Rule 2: the twelve rhythm templates, one bar of 16 steps each (1 a note, 0 a rest); the kick is on step 1, 5, 9, 13.
const TPL = [
  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,  0, 0, 1, 0,    //  1 offbeat stabs
  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,  1, 0, 1, 0,    //  2 straight eighths
  1, 0, 0, 1,  0, 0, 1, 0,  1, 0, 0, 1,  0, 0, 1, 0,    //  3 3-3-2 twice
  1, 0, 0, 1,  0, 0, 1, 0,  0, 1, 0, 0,  1, 0, 1, 0,    //  4 3-3-3-3-2-2
  1, 0, 1, 1,  1, 0, 1, 1,  1, 0, 1, 1,  1, 0, 1, 1,    //  5 gallop
  1, 1, 1, 0,  1, 1, 1, 0,  1, 1, 1, 0,  1, 1, 1, 0,    //  6 gallop turned round
  0, 1, 1, 1,  0, 1, 1, 1,  0, 1, 1, 1,  0, 1, 1, 1,    //  7 16ths that leave the kick alone
  0, 0, 1, 1,  0, 0, 1, 1,  0, 0, 1, 1,  0, 0, 1, 1,    //  8 double offbeat
  1, 0, 1, 0,  1, 0, 0, 1,  0, 0, 1, 0,  1, 0, 0, 0,    //  9 hook with a gap at the end
  1, 0, 1, 1,  0, 0, 1, 0,  1, 0, 1, 1,  0, 0, 0, 0,    // 10 call, then room for the answer
  1, 0, 0, 1,  0, 0, 1, 0,  0, 0, 1, 0,  1, 0, 0, 0,    // 11 sparse syncopation
  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1,  1, 1, 1, 1     // 12 run of 16ths
];
// All weights, row by row (W_... below says where a row starts). A row need not add up to 100.
const WT = [
  12, 10, 12, 10, 8, 6, 8, 8, 10, 8, 6, 2,    // W_TPL    rule 2: template 1 to 12
  35, 20, 15, 10, 10, 10,                     // W_PROG   rule 3: the six progressions of PROG
  50, 30, 0,                                  // W_KICK   rule 4: root, fifth, third on a kick step. The rule says 50 30 20, the
                                              //          design "root and fifth on the kick": the third is off until an ear says else
  50, 30, 20,                                 // W_FIRST  rule 4: root, fifth, third as first note of a bar that starts off the kick
  35, 40, 15, 10,                             // W_MOVE   rule 5: same note, a step, a leap of a third or fourth onto a chord tone, an octave
  40, 30, 20, 10,                             // W_FORM   rule 7: AAAB, AA'AB, ABAC, AAAA
  40, 35, 25                                  // W_TURN   rule 8: run of 16ths to the last note, long last note, last beat silent
];
const W_TPL = 0;
const W_PROG = 12;
const W_KICK = 18;
const W_FIRST = 21;
const W_MOVE = 24;
const W_FORM = 28;
const W_TURN = 32;
// Rule 3: the degree (1 to 7) the chord of each of four bars stands on. The last row takes the place of the first in Phrygian.
const PROG = [
  1, 1, 1, 1,
  1, 6, 3, 7,
  1, 1, 6, 7,
  1, 7, 6, 5,
  1, 4, 6, 7,
  1, 6, 7, 1,
  1, 2, 1, 2
];
const PHRYGIAN = 3;         // the scale number of Phrygian on the device
const FOLD = 6;             // a chord whose root is more semitones than this above the key lies below it instead (5, b6, b7)
// Rule 4: how much a tone weighs where rule 5 leaves a choice (step up or down, which chord tone to leap to), by its
// semitones 0 to 11 above the key: 1 = 30, 2 = 6, 3 = 16, 4 = 8, 5 = 20, 6 = 10, 7 = 10, flat or not (the tritone as a fourth).
const SEMI_W = [30, 6, 6, 16, 16, 8, 8, 20, 10, 10, 10, 10];
// Rule 5
const MAX_TONES = 5;        // different tones in a bar, the chord's root and fifth always among them
const LOW = -2;             // the motif's lowest tone, in tones of the scale from the key (-2: b6 and b7 lie below the root);
                            // its highest is an octave above that, an octave jump goes one further
// Rule 6: gates in 1/96 of a 16th step
const GATE_16 = 48;         // a note with another on the next 16th
const GATE_8 = 72;          // any other note: staccato
const GATE_HOLD = 96;       // the last step of a held note (96 is a whole step, more would tie it to the next note)
const P_HOLD_LAST = 60;     // percent: the last note of the motif is held
const P_HOLD_GAP = 40;      // percent: a note before a gap is held
const GAP_MIN = 3;          // rests that make a gap
const HOLD_MIN = 2;         // a held note lasts HOLD_MIN to HOLD_MAX 16th steps
const HOLD_MAX = 4;
// Rule 7: what bar 1 to 4 is in each form: 0 A, 1 A' (the last one or two notes moved a step), 2 B and 3 C (turnarounds).
// The last bar of a pattern is always the form's fourth, whatever the pattern's length.
const FORM = [
  0, 0, 0, 2,
  0, 1, 0, 2,
  0, 2, 0, 3,
  0, 0, 0, 0
];
const P_SHIFT = 70;         // percent: with the chord all notes move; else only the ones on the kick and the first of the bar
// Rule 8
const P_END_ROOT = 70;      // percent: a turnaround ends on the root of its chord, else on the fifth
const RUN_TONES = 3;        // different tones in the run of 16ths
// Rule 9: BASS
const BASS_A = 0;           // the two templates of the bass (numbered from 0), drawn by their weights in W_TPL
const BASS_B = 7;
const P_BASS_OCT = 25;      // percent: the last offbeat of a bar is an octave up
const GATE_BASS = 60;
// Rule 10: a motif with fewer notes gets some more, one with more loses some (never the first, never one on the kick)
const DENS_MIN = 5;
const DENS_MAX = 10;
// Rule 1
const P_MOTIF32 = 25;       // percent: the motif is two bars long (only in a pattern of four bars or more)
// Not in the rules
const ROOT_NOTE = 48;       // the key's root, C3 as BLECHTRIBE's dice has it
const OCTAVE = 0;           // octaves up or down for everything
const VEL = 96;             // velocity, 1 to 127
const VEL_KICK = 112;       // of a note on a kick step
const SHIFT_MS = 10000;     // a SHIFT held longer than this is forgotten (it was let go where the plugin could not see it)
// ======================================================================================================================
// end of the table
// ======================================================================================================================

// The device: steps a beat for BEAT 16, 32, 8 Tri, 16 Tri and 8 (BLECHTRIBE), and the step inside a beat that each of the
// four 16ths of a template falls on.
const SPB = [4, 8, 3, 6, 2];
const MAP = [
  0, 1, 2, 3,
  0, 2, 4, 6,
  0, 1, 2, 2,
  0, 2, 4, 4,
  0, 0, 1, 1
];
// The 35 scales of the device (Parameter Guide, Scale List), two bytes each: bit n set means n semitones above the key.
const SCALE = [
  255, 15,  181, 10,  173, 6,   171, 5,   213, 10,    // Chromatic, Ionian, Dorian, Phrygian, Lydian
  181, 6,   173, 5,   107, 5,   173, 9,   173, 10,    // Mixolydian, Aeolian, Locrian, Harm minor, Melo minor
  157, 2,   233, 4,   109, 11,  219, 6,   149, 2,     // Major Blues, minor Blues, Diminished, Com.Dim, Major Penta
  169, 4,   179, 9,   211, 10,  203, 9,   117, 5,     // minor Penta, Raga 1, Raga 2, Raga 3, Arabic
  187, 5,   205, 9,   165, 4,   141, 2,   139, 1,     // Spanish, Gypsy, Egyptian, Hawaiian, Pelog
  163, 1,   177, 8,   209, 8,   129, 4,   85, 5,      // Japanese, Ryukyu, Chinese, Bass Line, Whole Tone
  73, 2,    17, 1,    33, 4,    129, 0,   1, 0        // minor 3rd, Major 3rd, 4th Interval, 5th Interval, Octave
];
const AEOLIAN = 6;          // a Chromatic pattern gets natural minor
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const REST = 99;            // no note on a step; also "none" for a step number or a tone
const OFF = 12;             // tone i is bit i + OFF of a tone mask
// A line is made in pieces over several frames: reading the pattern takes the press's frame, then every frame takes pieces as long as they fit
// into BUDGET cost units (the simulator's units; the fork reckons 2630 of them at 0.5 ms). What a piece costs, measured:
const BUDGET = 2100;
const C_KICK = 200;         // the tone of a note on the kick
const C_STEP = 380;         // the tone of a note off the kick ...
const C_LEAP = 650;         // ... when it leaps
const C_SLOT = 25;          // passing a rest of the motif
const C_NOTE = 235;         // writing a step with a note
const C_REST = 125;         // writing a step without

// store: 0 the page MELODY; 1 a start seed, which only a test sets (never written here: the first press takes the time)
let mode = korg.store.get(0, 1);
if (mode < 0 || mode > 2) mode = 1;
let seed = korg.store.get(1, 0);
let page = korg.menu.add("MELODY", 0, 2, mode);
// API 27: the page sits in BLECH -> FEATURES and shows its value by name.
korg.menu.group(page, "FEATURES");
function modeText(v) {
  if (v == 0) korg.menu.text(page, "RANDOM");
  else if (v == 1) korg.menu.text(page, "HARDTEKK");
  else if (v == 2) korg.menu.text(page, "BASS");
  return 0;
}
modeText(mode);
let shift = 0;              // SHIFT is down and PART ERASE is kept from the firmware
let shiftAt = korg.millis(); // when it came down; the call also starts the clock, whose time is the first seed
let want = 0;               // presses not yet turned into a line
let wantPart = 0;
// 0 at rest; 1 the line's dice, 2 to 5 the motif (template, density, tones, gates), 6 a bar's chord and form, 7 its variation, 8 writing it
let job = 0;
let todo = 0;               // what is left of the frame's BUDGET
let rs = 1;                 // the generator's state

// the line being made: all of it is read once, when the line starts
let kind = 1;
let part = 0;
let pattern = 0;
let beat = 0;
let spb = 4;                // steps a beat
let B = 16;                 // steps a musical bar
let P = 16;                 // steps the part plays of each 16 of the pattern
let N = 64;                 // steps the part plays in all
let M = 4;                  // musical bars, the last one may be cut off
let n = 7;                  // tones of the scale
let phrygian = 0;           // 1: the scale is Phrygian
let lo = 0;                 // the motif's lowest and highest tone
let hi = 7;
let base = 48;              // MIDI note of the key
let g16 = 48;               // the gates of rule 6 and 9 on this BEAT's steps
let g8 = 72;
let gBass = 60;
let prog = 0;
let form = 0;
let shiftAll = 0;
let two = 0;                // 1: the motif is two bars
let laid = 0;               // notes the template put into the motif bar
let turnB = 0;              // how B and C turn around (0 run, 1 long note, 2 silence) and where they end (0 root, 1 fifth)
let turnC = 0;
let endB = 0;
let endC = 0;
let runDir = 1;
const WS = new Array(35);   // the sum of each row of WT, at the row's start
const pcs = new Array(12);  // the scale: semitones above the key
const cT = new Array(3);    // root, fifth and third of the chord on the key, as tones of the scale
const sl = new Array(16);   // the step of a bar that each 16th of a template falls on
let inBar = 16;             // how many of them fall into the motif's bar (the first ones)
// the motif, bar 1 from 0 and bar 2 from 32: per step the tone (REST for none), 0 or 1 + the chord tone a stressed note is, gate, steps held
const mI = new Array(64);
const mR = new Array(64);
const mG = new Array(64);
const mH = new Array(64);
let mAt = 0;
let mLen = 16;
let mPos = 0;
let mFirst = 1;
let cur = 0;                // the walk: the last tone, the tone to come back to after an octave, the direction of the last leap
let back = REST;
let leap = 0;
let sTones = 0;             // masks of the tones the stressed and the other notes of the motif use, and how many that is
let uTones = 0;
let tones = 0;
// the bar being written
let bar = 0;
let src = 0;                // its bar of the motif
let len = 16;
let cut = 16;               // steps taken from the motif; behind them the turnaround in tI, tG, tH
let pos = 0;
let what = 0;               // 0 A, 1 A', 2 B, 3 C
let turn = 0;               // the turnaround's kind, its last tone, kinds tried
let goal = 0;
let tries = 0;
let up = 0;                 // BASS: this bar's last offbeat is an octave up
let a1 = REST;              // A': up to two steps whose tone is v1, v2 instead
let a2 = REST;
let v1 = 0;
let v2 = 0;
let seen = 0;               // the tones of the bar so far and how many
let count = 0;
let holdLeft = 0;           // a held note: steps to go, note, velocity
let holdNote = 0;
let holdVel = 0;
const dl = new Array(4);    // what the bar's chord adds to a tone of the motif: plain notes, root, fifth, third
const tI = new Array(16);
const tG = new Array(16);
const tH = new Array(16);

function rowSum(at, rows) {
  let total = 0;
  let k = 0;
  while (k < rows) { total += WT[at + k]; k += 1; }
  return total;
}
WS[W_TPL] = rowSum(W_TPL, 12);
WS[W_PROG] = rowSum(W_PROG, 6);
WS[W_KICK] = rowSum(W_KICK, 3);
WS[W_FIRST] = rowSum(W_FIRST, 3);
WS[W_MOVE] = rowSum(W_MOVE, 4);
WS[W_FORM] = rowSum(W_FORM, 4);
WS[W_TURN] = rowSum(W_TURN, 3);

// xorshift32; 0 to k - 1
function rnd(k) {
  rs ^= rs << 13;
  rs ^= (rs >> 17) & 0x7FFF;
  rs ^= rs << 5;
  if (k < 1) return 0;
  return ((rs >> 8) & 0xFFFFFF) % k;
}

// one of the `rows` entries of the row of WT that starts at `at`, by weight
function draw(at, rows) {
  let r = rnd(WS[at]);
  let k = 0;
  while (k < rows - 1) {
    if (r < WT[at + k]) return k;
    r -= WT[at + k];
    k += 1;
  }
  return k;
}

// MIDI note of tone i of the scale: 0 the key, n the octave above, -1 the tone below the key
function note(i) {
  let o = base;
  while (i < 0) { i += n; o -= 12; }
  while (i >= n) { i -= n; o += 12; }
  return o + pcs[i];
}

// the tone nearest to s semitones above the key (s from 0), the upper one when two are as near
function near(s) {
  let o = 0;
  while (s >= 12) { s -= 12; o += n; }
  // the first tone at or above s (the octave when there is none), or the one below when that is nearer
  let k = 0;
  while (k < n && pcs[k] < s) k += 1;
  let above = 12 - s;
  if (k < n) above = pcs[k] - s;
  if (k > 0 && s - pcs[k - 1] < above) k -= 1;
  return k + o;
}

// tone of the chord on tone r: which 0 the root, 1 the fifth, 2 the third. A scale of seven tones stacks its own thirds,
// any other takes its tones nearest to a fifth and a minor third above the root.
function chordTone(r, which) {
  if (which == 0) return r;
  if (n == 7) return r + 6 - 2 * which;
  let s = note(r) - base;
  let o = 0;
  while (s < 0) { s += 12; o -= n; }
  if (which == 1) return near(s + 7) + o;
  return near(s + 3) + o;
}

// the tone a chord stands on, from its degree 1 to 7 (rule 3)
function chordRoot(degree) {
  let r = degree - 1;
  if (n != 7) r = near(MINOR[r]);
  if (note(r) - base > FOLD) r -= n;
  return r;
}

// 1 when a piece that costs about c fits into what is left of the frame (a fresh frame takes any piece), else the frame ends
function fits(c) {
  if (todo < c && todo < BUDGET) { todo = 0; return 0; }
  todo -= c;
  return 1;
}

// Rule 2 and 9: a template onto the steps of the motif bar at `at`. Returns the number of notes.
function lay(at) {
  let t = BASS_A;
  if (kind != 2) t = draw(W_TPL, 12);
  else if (rnd(WT[W_TPL + BASS_A] + WT[W_TPL + BASS_B]) >= WT[W_TPL + BASS_A]) t = BASS_B;
  let s = 0;
  while (s < mLen) { mI[at + s] = REST; s += 1; }
  let c = 0;
  let k = 0;
  t = t * 16;
  while (k < inBar) {
    if (TPL[t + k] == 1) {
      s = sl[k];
      if (mI[at + s] == REST) { mI[at + s] = 0; c += 1; }
    }
    k += 1;
  }
  // rule 9: a pattern that ends before its first offbeat gets its last step
  if (kind == 2 && c == 0) mI[at + mLen - 1] = 0;
  return c;
}

// Rule 10: between `least` and `most` notes in the motif bar at `at`, which has c.
function fit(at, c, least, most) {
  let s = 0;
  let k = 0;
  // too few: more notes where a template could have one, off the kick while there is room
  let kickToo = 0;
  while (c < least && kickToo < 2) {
    let k0 = rnd(inBar);
    let found = 0;
    k = 0;
    while (k < inBar && found == 0) {
      s = sl[(k0 + k) % inBar];
      if (mI[at + s] == REST && (kickToo == 1 || s % spb != 0)) { mI[at + s] = 0; c += 1; found = 1; }
      k += 1;
    }
    if (found == 0) kickToo += 1;
  }
  // too many: notes go, never the first and none on the kick
  let first = 0;
  while (first < mLen && mI[at + first] == REST) first += 1;
  while (c > most) {
    let k0 = rnd(inBar);
    let found = 0;
    k = 0;
    while (k < inBar && found == 0) {
      s = sl[(k0 + k) % inBar];
      if (s != first && mI[at + s] != REST && s % spb != 0) { mI[at + s] = REST; c -= 1; found = 1; }
      k += 1;
    }
    if (found == 0) c = most;
  }
}

// Rule 4: what tone i weighs
function weight(i) {
  while (i < 0) i += n;
  while (i >= n) i -= n;
  return SEMI_W[pcs[i]];
}

// Rule 5: a step from tone c, up or down by the weight of where it lands, inside the motif's octave.
function stepFrom(c) {
  if (c <= lo) return c + 1;
  if (c >= hi) return c - 1;
  let wu = weight(c + 1);
  if (rnd(wu + weight(c - 1)) < wu) return c + 1;
  return c - 1;
}

// Rule 5: a leap of a third or fourth (3 to 6 semitones) from tone c onto a chord tone, REST when there is none.
function leapFrom(c) {
  let from = note(c) - base;
  let best = REST;
  let total = 0;
  let k = 0;
  while (k < 4) {
    // root, fifth, third and the octave above the key
    let t = n;
    if (k < 3) t = cT[k];
    let at = 12;
    let w = SEMI_W[0];
    if (t < n) { at = pcs[t]; w = SEMI_W[at]; }
    let d = at - from;
    let dir = 1;
    if (d < 0) { d = 0 - d; dir = -1; }
    if (d >= 3 && d <= 6 && t <= hi) {
      total += w;
      if (rnd(total) < w) { best = t; leap = dir; }
    }
    k += 1;
  }
  return best;
}

// Rule 5: tone i for a note off the kick if the motif may have one more tone, else the nearest tone such notes have already.
function keep(i) {
  let b = 1 << (i + OFF);
  if ((uTones & b) != 0) return i;
  if (tones < MAX_TONES) { uTones |= b; tones += 1; return i; }
  let d = 1;
  while (d < 16) {
    if (i - d + OFF >= 0 && ((uTones >> (i - d + OFF)) & 1) == 1) return i - d;
    if (i + d + OFF < 32 && ((uTones >> (i + d + OFF)) & 1) == 1) return i + d;
    d += 1;
  }
  return 0;
}

// Rule 4 and 5: the tones of the motif bar at mAt, as many as the frame has room for.
function walk() {
  while (mPos < mLen && todo >= C_LEAP) {
    let i = mI[mAt + mPos];
    todo -= C_SLOT;
    if (i != REST) {
      let role = 0;
      if (mPos % spb == 0) role = 1 + draw(W_KICK, 3);
      else if (mFirst == 1) role = 1 + draw(W_FIRST, 3);
      if (role != 0) {
        // a chord tone, the root an octave up when that is nearer
        i = cT[role - 1];
        if (role == 1 && n <= hi && cur + cur > n) i = n;
        let b = 1 << (i + OFF);
        if ((sTones & b) == 0) {
          if (tones < MAX_TONES) { sTones |= b; tones += 1; } else i = 0;
        }
        back = REST;
        leap = 0;
        todo -= C_KICK;
      } else {
        let move = draw(W_MOVE, 4);
        i = cur;
        if (back != REST) { i = back; back = REST; }
        else if (leap != 0) { i = cur - leap; leap = 0; }
        else if (move == 3) {
          if (cur <= hi) { i = cur + n; back = cur; }
        } else {
          if (move == 2) { i = leapFrom(cur); todo -= C_LEAP - C_STEP; }
          if (move == 1 || i == REST) i = stepFrom(cur);
        }
        i = keep(i);
        todo -= C_STEP;
      }
      mI[mAt + mPos] = i;
      mR[mAt + mPos] = role;
      cur = i;
      mFirst = 0;
    }
    mPos += 1;
  }
  if (mPos < mLen) todo = 0;
  else job = 5;
}

// Rule 6: gate and length of every note of the motif bar at mAt, from its last note back.
function gates() {
  let s = mLen - 1;
  let next = mLen;
  let last = 1;
  while (s >= 0) {
    if (mI[mAt + s] != REST) {
      let d = next - s;
      let d16 = d * 4 / spb;
      let g = g8;
      if (d16 < 2) g = g16;
      let h = 1;
      let p = 0;
      if (last == 1) p = P_HOLD_LAST;
      else if (d16 > GAP_MIN) p = P_HOLD_GAP;
      if (p > 0 && rnd(100) < p) {
        h = (HOLD_MIN + rnd(HOLD_MAX - HOLD_MIN + 1)) * spb / 4;
        if (h < 2) h = 2;
        if (h > d) h = d;
      }
      mG[mAt + s] = g;
      mH[mAt + s] = h;
      next = s;
      last = 0;
    }
    s -= 1;
  }
}

// A press becomes a line: the seed moves on, the pattern and the part are read.
function begin() {
  if (seed == 0) seed = (korg.millis() + 1) * 48271;
  if (seed == 0) seed = 1;
  while (want > 0) { rs = seed; rnd(1); seed = rs; want -= 1; }
  rs = seed ^ 0x2545F491;
  if (rs == 0) rs = 1;
  kind = mode;
  part = wantPart;
  pattern = korg.read.pattern();
  beat = korg.pattern.current.beat;
  if (beat < 0 || beat > 4) beat = 0;
  spb = SPB[beat];
  B = 4 * spb;
  P = 16;
  if (beat == 2 || beat == 3) P = 12;
  let last = korg.parts[part].lastStep;
  if (last > 0 && last < P) P = last;
  N = korg.pattern.current.length * P;
  M = (N + B - 1) / B;
  g16 = GATE_16 * spb / 4;
  if (g16 > 96) g16 = 96;
  g8 = GATE_8 * spb / 4;
  if (g8 > 96) g8 = 96;
  gBass = GATE_BASS * spb / 4;
  if (gBass > 96) gBass = 96;
  // the scale; a Chromatic pattern gets natural minor
  let sc = korg.pattern.current.scale;
  if (sc < 1 || sc > 34) sc = AEOLIAN;
  phrygian = 0;
  if (sc == PHRYGIAN) phrygian = 1;
  base = ROOT_NOTE + 12 * OCTAVE + korg.pattern.current.key;
  n = 0;
  let k = 0;
  while (k < 12) {
    if (((SCALE[sc * 2 + (k >> 3)] >> (k & 7)) & 1) == 1) { pcs[n] = k; n += 1; }
    k += 1;
  }
  mLen = N;
  if (mLen > B) mLen = B;
  inBar = 0;
  k = 0;
  while (k < 16) {
    sl[k] = (k >> 2) * spb + MAP[beat * 4 + (k & 3)];
    if (sl[k] < mLen) inBar += 1;
    k += 1;
  }
  lo = LOW;
  if (lo > 0 || lo < 0 - n || n < 3) lo = 0;
  hi = lo + n;
  job = 1;
}

// The line's dice (rule 1, 3, 7, 8) and where the motif starts.
function cast() {
  cT[0] = 0;
  cT[1] = chordTone(0, 1);
  cT[2] = chordTone(0, 2);
  prog = draw(W_PROG, 6);
  if (prog == 0 && phrygian == 1) prog = 6;
  form = draw(W_FORM, 4);
  shiftAll = 0;
  if (rnd(100) < P_SHIFT) shiftAll = 1;
  turnB = draw(W_TURN, 3);
  turnC = (turnB + 1 + rnd(2)) % 3;
  endB = 0;
  if (rnd(100) >= P_END_ROOT) endB = 1;
  endC = 0;
  if (rnd(100) >= P_END_ROOT) endC = 1;
  runDir = 1 - 2 * rnd(2);
  two = 0;
  if (kind == 1 && M > 3 && rnd(100) < P_MOTIF32) two = 1;
  // root and fifth of the chord count among the motif's tones from the start: a note on the kick always finds one
  sTones = (1 << OFF) | (1 << (cT[1] + OFF));
  tones = 2;
  uTones = 0;
  cur = 0;
  back = REST;
  leap = 0;
  mAt = 0;
  bar = 0;
}

// The tones of the bar's first `to` steps into seen and count; the chord's root and fifth always count.
function census(to) {
  seen = (1 << (dl[1] + OFF)) | (1 << (cT[1] + dl[2] + OFF));
  count = 2;
  let s = 0;
  while (s < to) {
    let i = mI[src + s];
    if (i != REST) {
      let b = 1 << (i + dl[mR[src + s]] + OFF);
      if ((seen & b) == 0) { seen |= b; count += 1; }
    }
    s += 1;
  }
}

// 1 when tone i may sound in the bar: it does already, or the bar has room for one more tone (which it then is).
function room(i) {
  let b = 1 << (i + OFF);
  if ((seen & b) != 0) return 1;
  if (count >= MAX_TONES) return 0;
  seen |= b;
  count += 1;
  return 1;
}

// Rule 7, A': the last one or two notes of the bar's second half that are not on the kick move a step.
function vary() {
  census(len);
  let k = 1 + rnd(2);
  let s = len - 1;
  while (s >= len / 2 && k > 0) {
    if (mI[src + s] != REST && mR[src + s] == 0) {
      let i = mI[src + s] + dl[0];
      let d = 1 - 2 * rnd(2);
      let c = i + d;
      if (room(c) == 0) {
        c = i - d;
        if (room(c) == 0) c = i;
      }
      if (a1 == REST) { a1 = s; v1 = c; } else { a2 = s; v2 = c; }
      k -= 1;
    }
    s -= 1;
  }
}

// Rule 8: the second half of a turnaround of kind v (0 run, 1 long note, 2 last beat silent) that ends on tone goal, into
// tI, tG, tH from step `cut` of the bar. Returns 1 when the bar now ends differently from the motif.
function tail(v) {
  let size = len - cut;
  let k = 0;
  let s = 0;
  let c = 0;
  while (k < size) { tI[k] = REST; k += 1; }
  if (v == 0) {
    // 16ths between the kicks, down or up to the goal
    k = 0;
    while (k < 16) {
      s = sl[k];
      if (s >= cut && s < len && s % spb != 0 && tI[s - cut] == REST) { tI[s - cut] = 0; c += 1; }
      k += 1;
    }
    if (c == 0) v = 1;
    else {
      // as many tones as the bar has room for, the last one the goal
      census(cut);
      let w = 1;
      while (w < RUN_TONES && room(goal + runDir * w) == 1) w += 1;
      let j = 0;
      k = 0;
      while (k < size) {
        if (tI[k] != REST) {
          tI[k] = goal + runDir * (((c - 1 - j) * w) / c);
          tG[k] = g16;
          tH[k] = 1;
          j += 1;
        }
        k += 1;
      }
    }
  }
  if (v == 1) {
    tI[0] = goal;
    tG[0] = g8;
    tH[0] = size;
  }
  if (v == 2) {
    // the motif without its last beat; the last note left is the goal
    let end = len - spb - cut;
    let lastNote = REST;
    k = 0;
    while (k < end) {
      let i = mI[src + cut + k];
      if (i != REST) {
        tI[k] = i + dl[mR[src + cut + k]];
        tG[k] = mG[src + cut + k];
        tH[k] = mH[src + cut + k];
        if (tH[k] > end - k) tH[k] = end - k;
        lastNote = k;
      }
      k += 1;
    }
    if (lastNote != REST) tI[lastNote] = goal;
  }
  k = 0;
  while (k < size) {
    let i = mI[src + cut + k];
    if (i != REST) i += dl[mR[src + cut + k]];
    if (i != tI[k]) return 1;
    if (i != REST && mH[src + cut + k] != tH[k]) return 1;
    k += 1;
  }
  return 0;
}

// What bar `bar` is (rule 3, 7, 9): its chord, its bar of the motif, its place in the form.
function plan() {
  len = N - bar * B;
  if (len > B) len = B;
  src = 0;
  if (two == 1 && (bar & 1) == 1) src = 32;
  let r = chordRoot(PROG[prog * 4 + (bar & 3)]);
  dl[0] = 0;
  if (shiftAll == 1) dl[0] = r;
  dl[1] = r;
  dl[2] = chordTone(r, 1) - cT[1];
  dl[3] = chordTone(r, 2) - cT[2];
  cut = len;
  a1 = REST;
  a2 = REST;
  up = 0;
  pos = 0;
  holdLeft = 0;
  what = 0;
  if (kind == 2) {
    if (rnd(100) < P_BASS_OCT) up = 1;
    return;
  }
  // the last bar of the pattern is the form's last, a bar under two beats is too short to turn around
  if (bar == M - 1 && M > 1) what = FORM[form * 4 + 3];
  else if (two == 0) what = FORM[form * 4 + (bar & 3)];
  // the same turnaround twice in a row would be none (a pattern of five bars): the bar before the last is the motif then
  if (bar == M - 2 && what == FORM[form * 4 + 3]) what = 0;
  if (what > 1 && len < 2 * spb) what = 0;
  if (what > 1) {
    turn = turnB;
    goal = dl[1];
    if (what == 3) turn = turnC;
    if ((what == 2 && endB == 1) || (what == 3 && endC == 1)) goal = cT[1] + dl[2];
    cut = len / 2;
    tries = 0;
  }
}

// Writes the bar's steps from pos, as many as the frame has room for. A held note is the same note on every step it
// lasts, tied (gate 127) up to its last step; it ends where the part's bar of 16 ends, so no tie crosses to a step whose
// step before is not played.
function put() {
  let q = bar * B + pos;
  let o = q % P;
  let st = (q / P) * 16 + o;
  let kb = pos % spb;
  while (pos < len && todo >= C_NOTE) {
    let i = REST;
    let g = 0;
    let h = 1;
    if (pos < cut) {
      i = mI[src + pos];
      if (i != REST) {
        if (kind == 2) {
          // rule 9: the root of the bar's chord, short
          i = dl[1];
          g = gBass;
        } else {
          i += dl[mR[src + pos]];
          g = mG[src + pos];
          h = mH[src + pos];
          if (h > cut - pos) h = cut - pos;
        }
      }
    } else {
      i = tI[pos - cut];
      if (i != REST) { g = tG[pos - cut]; h = tH[pos - cut]; }
    }
    if (a1 != REST) {
      if (pos == a1) i = v1;
      if (pos == a2) i = v2;
    }
    if (i != REST) {
      if (up == 1 && pos >= len - spb) i += n;
      if (h > P - o) h = P - o;
      holdNote = note(i);
      if (holdNote < 0) holdNote = 0;
      if (holdNote > 127) holdNote = 127;
      holdVel = VEL;
      if (kb == 0) holdVel = VEL_KICK;
      holdLeft = h - 1;
      korg.seq.setStep(part, st, holdNote, holdVel);
      if (h > 1) g = 127;
      korg.seq.setGate(part, st, g);
      todo -= C_NOTE;
    } else if (holdLeft > 0) {
      holdLeft -= 1;
      korg.seq.setStep(part, st, holdNote, holdVel);
      if (holdLeft > 0) korg.seq.setGate(part, st, 127);
      else korg.seq.setGate(part, st, GATE_HOLD);
      todo -= C_NOTE;
    } else {
      korg.seq.setStep(part, st, -1, 0);
      todo -= C_REST;
    }
    pos += 1;
    st += 1;
    o += 1;
    if (o == P) { o = 0; st += 16 - P; holdLeft = 0; }
    kb += 1;
    if (kb == spb) kb = 0;
  }
  if (pos < len) { todo = 0; return; }
  bar += 1;
  job = 6;
  if (bar >= M) job = 0;
}

// The next piece of the line.
function piece() {
  if (job == 1) {
    let c = 950;
    if (n != 7) c = 1200;
    if (fits(c) == 0) return;
    cast();
    job = 2;
    return;
  }
  if (job == 2) {
    if (fits(1000 + 15 * mLen) == 0) return;
    laid = lay(mAt);
    mPos = 0;
    mFirst = 1;
    job = 3;
    if (kind == 2) job = 6;
    return;
  }
  if (job == 3) {
    // rule 10, for the steps the bar has
    let least = DENS_MIN * mLen / B;
    if (least < 1) least = 1;
    let most = DENS_MAX * mLen / B;
    if (most < least) most = least;
    let c = 320;
    if (laid < least) c += 500 * (least - laid);
    if (laid > most) c += 250 * (laid - most);
    if (fits(c) == 0) return;
    fit(mAt, laid, least, most);
    job = 4;
    return;
  }
  if (job == 4) { walk(); return; }
  if (job == 5) {
    if (fits(560 + 30 * mLen) == 0) return;
    gates();
    job = 6;
    if (two == 1 && mAt == 0) { mAt = 32; job = 2; }
    return;
  }
  if (job == 6) {
    let c = 300;
    if (n != 7) c = 900;
    if (fits(c) == 0) return;
    plan();
    job = 8;
    if (what != 0) job = 7;
    return;
  }
  if (job == 7) {
    let c = 750 + 60 * len;
    if (what == 1) c = 450 + 45 * len;
    if (fits(c) == 0) return;
    job = 8;
    if (what == 1) { vary(); return; }
    // a turnaround that leaves the bar as the motif has it is no turnaround: the next kind, in the next piece
    if (tail(turn) == 0 && tries < 2) { turn = (turn + 1) % 3; tries += 1; job = 7; }
    return;
  }
  put();
}

// While SHIFT is down PART ERASE belongs to this plugin: the firmware, and with it BLECHTRIBE's dice, does not see the press.
korg.onEvent("buttonPress", (key) => {
  if (key == korg.key.SHIFT) {
    if (mode != 0) { shift = 1; shiftAt = korg.millis(); korg.keyHold(korg.key.PART_ERASE, 1); }
  } else if (key == korg.key.PART_ERASE && shift == 1) {
    want += 1;
    wantPart = korg.read.part();
  }
});
korg.onEvent("buttonRelease", (key) => {
  if (key == korg.key.SHIFT && shift == 1) { shift = 0; korg.keyHold(korg.key.PART_ERASE, 0); }
});

korg.onEvent("menu", (id, value) => {
  if (id != page) return;
  mode = value;
  modeText(value);
  korg.store.set(0, value);
  korg.store.save();
  if (mode == 0 && shift == 1) { shift = 0; korg.keyHold(korg.key.PART_ERASE, 0); }
});

// A line never takes a frame's time: it is made piece by piece. A press while a line is made waits for its end, so two
// lines never mix; the line is for the part and the pattern of its start, another pattern in RAM ends it.
korg.onEvent("frame", () => {
  if (job == 0) {
    if (shift == 1 && korg.millis() - shiftAt > SHIFT_MS) { shift = 0; korg.keyHold(korg.key.PART_ERASE, 0); }
    if (want == 0) return;
    // no single part, or the display shows another pattern than the one in RAM: nothing the user sees could take the line
    if (wantPart > 15 || korg.read.viewedPattern() != korg.read.pattern()) { want = 0; return; }
    begin();
    return;
  }
  if (korg.read.pattern() != pattern) { job = 0; want = 0; return; }
  todo = BUDGET;
  while (job != 0 && todo > 0) piece();
});
