// SPIELEN: Kuerzel
// fuers Live-Spiel.
// Immer erst EXIT
// halten, dann die
// Taste.
//
// ROULETTE: EXIT +
// PART ERASE gibt dem
// gewaehlten Part ein
// anderes Sample
// derselben Kategorie.
// Eigene Samples (ab
// 501): kurze nur
// gegen kurze, lange
// (ab 3 s) gegen
// lange. Gespeichert
// wird nicht von
// selbst.
//
// PARTY LOCK: EXIT +
// MFX HOLD eine
// Sekunde halten
// sperrt Regler und
// Tasten. Pads,
// Touchpad, PLAY und
// STOP gehen weiter.
// Die EXIT-LED blinkt.
// Dasselbe nochmal
// gibt alles frei.
//
// MUTE-SZENEN: EXIT +
// Taste 1 bis 4.
// Tippen ruft die
// Mutes ab, 0,6 s
// halten merkt sie.
// Bleibt ueber den
// Neustart.
//
// DROP: EXIT + PART
// MUTE halten: nur der
// gewaehlte Part
// spielt. EXIT darf
// dann los, PART MUTE
// haelt den Drop.
// Loslassen: Mutes wie
// vorher.
//
// TEMPO-RAMPE: EXIT +
// STEP JUMP. Das Tempo
// steigt um RAMP BPM
// ueber RAMP TAKTE.
// Nochmal: sofort
// zurueck.
//
// TAKT KOPIEREN: SHIFT
// halten, Taste 1 bis
// 4 fuer die Quelle,
// dann fuer das Ziel.
// Gilt fuer den
// gewaehlten Part.
// EXIT + SHIFT: fuer
// alle Parts, und das
// Pattern wird bei
// Bedarf laenger.
//
// CHANCE: EXIT + MFX
// SEND stellt fuer den
// gewaehlten Part ein,
// wie oft seine Steps
// anschlagen: 75, 50,
// 25 Prozent, dann
// wieder AUS. Der Part
// wird dafuer kurz
// stumm geschaltet.
// Nach dem Neustart
// AUS.
//
// == SEITEN, WERTE ==
//
// RAMP BPM: 1 bis 60
//
// RAMP TAKTE: 1 bis 16
//
// CHANCE: AUS 75 50 25

// Needs DISTRICT (API 26). Seven features in one plugin, because they share three things: the state of EXIT, the mutes, and
// the lock that switches every other combination off. No `frame` handler: a frame without a key, a step or a timer costs 0.
//
// Two things shape the code:
// - EXIT on the device (read in district/tools/patch/script_hooks.s, input_button; the simulator reports the release): while
//   any plugin owns the display, an EXIT press closes it and is NOT reported, and an EXIT release is not reported either. So
//   this plugin never takes the display while EXIT is down (texts wait for the release, say()), takes its own `close` as an
//   EXIT press, and never trusts a held EXIT for long: a key that is not ours ends it (EXIT + TAP is AUTO BPM's, whose text
//   hides our release), and so do EXIT_MS without one of our keys.
// - A timer that was due in the frame in which it is cancelled still runs. Every timer function checks its own flag first.
//
// store: 0-3 the mute scenes (a bit per part, -1 never stored), 4 RAMP BPM, 5 RAMP TAKTE,
// 6 PTN. CHANGE LOCK as it was before the lock, plus 1 (0: nothing to put back)

// ---- to tune on the device
const EXIT_MS = 5000;   // a held EXIT counts this long after the last of our keys
const LOCK_MS = 1000;   // EXIT + MFX HOLD this long locks
const SCENE_MS = 600;   // EXIT + 1 to 4 this long stores
const MSG_MS = 800;     // a text stays this long; the keys do not reach the firmware meanwhile
const BLINK_MS = 400;   // the EXIT LED while locked
const SNAP_MS = 200;    // after a pattern change the new pattern is read this much later
const LONG_S = 3;       // a user sample of this many seconds and more is "long"
const PROBES = 16;      // sample slots looked at per frame
const MUTES = 8;        // mutes switched per frame (DROP, scenes); lower it if TIME shows up
const COPIES = 4;       // parts copied per frame

// ---- keys
const BAR = korg.key.BAR_1;
const BARS = 15 << korg.key.BAR_1;
// what we keep from the firmware while EXIT is down, and while locked: everything but STOP, PLAY and EXIT
const COMBO = BARS | (1 << korg.key.PART_ERASE) | (1 << korg.key.MFX_HOLD) | (1 << korg.key.PART_MUTE) | (1 << korg.key.STEP_JUMP) | (1 << korg.key.MFX_SEND);
const LOCKED = ~((1 << korg.key.STOP) | (1 << korg.key.PLAY) | (1 << korg.key.EXIT));

// The first index (slot minus 1) of each sample category; the last entry ends the list. Slots 1-16 waveforms, 17-18 Audio In,
// then the factory layout as the factory export has it (Kick 19, Snare 56, Clap 100, HiHat 112, Cymbal 149, Hits 157,
// Shots 190, Voice 234, SE 265, FX 272, Tom 302, Perc 312, Phrase 343, Loop 358, PCM 391), 422-500 unused, 501-999 user.
const CAT = [0, 16, 18, 55, 99, 111, 148, 156, 189, 233, 264, 271, 301, 311, 342, 357, 390, 421, 500, 999];
// PART_FIELDS the encoders SAMPLE, CUTOFF, MOD TYPE and IFX TYPE change; IFX EDIT last, the firmware resets it with the type
const ENC = [0, 2, 5, 13, 14];

let exitDown = 0;
let exitAt = 0;
let exitTimer = -1;
let shiftDown = 0;
let workArmed = 0;
let seed = 1;

let msgOn = 0;
let msgTimer = -1;
let pend = 0;
let pendA = 0;
let pendB = 0;

let rLeft = 0;   // slots still to look at; 0: no roulette under way
let rPart = 0;
let rCur = 0;
let rLo = 0;
let rHi = 0;
let rPos = 0;
let rLong = 0;

let locked = 0;
let lockArmed = 0;
let lockTimer = -1;
let blinkTimer = -1;
let blink = 0;
let padSafe = 0;   // 1 once the last pad mode key was TRIGGER, KEYBOARD or CHORD
let pcl = 0;
let fixArmed = 0;
let snapOk = 0;
let snapPos = 16;
let snapTimer = -1;
const snap = new Array(80);

let scene = -1;
let sceneArmed = 0;
let sceneTimer = -1;
let mWant = 0;
let mBusy = 0;
let dropOn = 0;
let dropSaved = 0;

let rampBpm = korg.store.get(4, 10);
let rampBars = korg.store.get(5, 4);
let pgBpm = korg.menu.add("RAMP BPM", 1, 60, rampBpm);
let pgBars = korg.menu.add("RAMP TAKTE", 1, 16, rampBars);
// API 27: both pages sit in BLECH -> FEATURES.
korg.menu.group(pgBpm, "FEATURES");
korg.menu.group(pgBars, "FEATURES");
let rampOn = 0;
let rampBase = 0;
let rampUp = 0;
let rampBeat = 0;
let rampBeats = 0;
let rampTimer = -1;

let copySrc = -1;
let cSrc = 0;
let cDst = 0;
let cPart = 0;
let cEnd = 0;
const steps = new Array(192);
const queue = new Array(4);   // copies that wait: source | target << 2 | first part << 4 | number of parts << 8
let qHead = 0;
let qLen = 0;

const chance = new Array(16);   // per part 0 off, 1 to 3: that many of four hits are dropped
let chParts = 0;
let chMine = 0;                 // the parts CHANCE holds muted right now, a bit each

// 1 in the two triplet beats (8 Tri, 16 Tri): a bar plays 12 of its 16 steps, the counter jumps from 11 to 16.
function triplets() {
  const beat = korg.pattern.current.beat;
  if (beat == 2 || beat == 3) return 1;
  return 0;
}

function rnd(n) {
  seed = (seed ^ korg.millis()) * 1103515245 + 12345;
  return ((seed >> 16) & 32767) % n;
}

// ---- texts: two lines for MSG_MS. 1 lock on, 2 lock off, 3 scene, 4 scene stored, 5 scene empty, 6 no other sample,
// 7 no single part, 8 bar copied, 9 for all parts, 10 bar not in the pattern, 11 ramp, 12 ramp back, 13 chance, 14 slot refused
function hide() {
  if (msgOn == 0) return;
  msgOn = 0;
  msgTimer = -1;
  korg.display.release();
}

function show(code, a, b) {
  if (korg.display.take() != 1) return;
  korg.display.clear();
  if (code == 1) { korg.display.text("PARTY LOCK AN", 4, 16); korg.display.text("EXIT+MFX HOLD 1S", 4, 32); }
  else if (code == 2) { korg.display.text("PARTY LOCK AUS", 4, 16); }
  else if (code <= 5) {
    korg.display.textNumber("SZENE ", a, 4, 16);
    if (code == 4) korg.display.text("GEMERKT", 4, 32);
    if (code == 5) korg.display.text("LEER", 4, 32);
  }
  else if (code == 6) { korg.display.text("ROULETTE:", 4, 16); korg.display.text("KEIN ANDERES SAMPLE", 4, 32); }
  else if (code == 7) { korg.display.text("EINEN PART WAEHLEN", 4, 16); }
  else if (code <= 9) {
    korg.display.textNumber("TAKT ", a, 4, 16);
    korg.display.textNumber("> ", b, 46, 16);
    if (code == 9) korg.display.text("ALLE PARTS", 4, 32);
  }
  else if (code == 10) { korg.display.textNumber("TAKT ", a, 4, 16); korg.display.text("FEHLT", 46, 16); }
  else if (code == 11) { korg.display.textNumber("RAMPE BPM +", a, 4, 16); korg.display.textNumber("TAKTE ", b, 4, 32); }
  else if (code == 12) { korg.display.text("RAMPE ZURUECK", 4, 16); }
  else if (code == 13) {
    korg.display.textNumber("CHANCE PART ", a, 4, 16);
    if (b == 100) { korg.display.text("AUS", 4, 32); }
    else { korg.display.number(b, 4, 32); korg.display.text("PROZENT", 22, 32); }
  }
  else { korg.display.text("ROULETTE:", 4, 16); korg.display.text("SLOT ABGELEHNT", 4, 32); }
  korg.cancel(msgTimer);
  msgOn = 1;
  msgTimer = korg.after(MSG_MS, hide);
  if (msgTimer < 0) hide();
}

// While EXIT is down the text waits for its release (see the top).
function say(code, a, b) {
  if (exitDown == 1) { pend = code; pendA = a; pendB = b; return; }
  show(code, a, b);
}

// ---- work that is spread over frames: one timer for all of it, each job goes on while its own flag says so
function later() {
  if (workArmed == 1) return;
  if (korg.after(0, work) >= 0) workArmed = 1;
}

// ---- the keys the firmware does not get
function mask() {
  if (locked == 1) { korg.keyMask(LOCKED, 3); return; }
  let m = 0;
  if (exitDown == 1) m = COMBO;
  if (shiftDown == 1) m = m | BARS;
  korg.keyMask(m, 0);
}

// ---- mutes: all 16 parts to a bit mask, at most MUTES switches per frame
function muteMask() {
  let m = 0;
  for (let p = 0; p < 16; p++) m = m | (korg.read.mute(p) << p);
  return m;
}

function mPump() {
  let n = 0;
  for (let p = 0; p < 16; p++) {
    const w = (mWant >> p) & 1;
    if (korg.read.mute(p) != w) {
      if (n == MUTES) { later(); return; }
      korg.mute(p, w);
      n += 1;
    }
  }
  mBusy = 0;
}

function muteTo(m) {
  mWant = m;
  mBusy = 1;
  mPump();
}

// CHANCE opens what it muted, so that what a scene stores and a DROP gives back are the user's own mutes.
function chanceFree() {
  if (chMine == 0) return;
  for (let p = 0; p < 16; p++) {
    if (((chMine >> p) & 1) == 1 && korg.read.mute(p) == 1) korg.mute(p, 0);
  }
  chMine = 0;
}

// ---- DROP: from EXIT + PART MUTE until PART MUTE comes up. EXIT may be let go before, so that the pads can be played over
// it (with EXIT down they are BLECHTRIBE's EXIT + pad).
function dropDown() {
  const part = korg.read.part();
  if (part > 15 || dropOn == 1) return;
  chanceFree();
  dropSaved = muteMask();
  dropOn = 1;
  muteTo(65535 & ~(1 << part));
}

function dropUp() {
  if (dropOn == 0) return;
  dropOn = 0;
  muteTo(dropSaved);
}

// ---- EXIT
function exitOn() {
  exitDown = 1;
  exitAt = korg.millis();
  korg.cancel(exitTimer);
  exitTimer = korg.after(EXIT_MS, exitExpire);
  mask();
}

// tell 1: EXIT really came up, the waiting text may show. 0: we only stop trusting it.
function exitOff(tell) {
  exitDown = 0;
  korg.cancel(exitTimer);
  exitTimer = -1;
  lockArmed = 0;
  korg.cancel(lockTimer);
  mask();
  if (tell == 1 && pend != 0) show(pend, pendA, pendB);
  pend = 0;
}

function exitExpire() {
  if (exitDown == 0) return;
  let left = EXIT_MS - (korg.millis() - exitAt);
  // a drop that is still held keeps EXIT alive, for a roulette on the part that plays
  if (dropOn == 1) left = EXIT_MS;
  if (left > 0) { exitTimer = korg.after(left, exitExpire); return; }
  exitOff(0);
}

// ---- SAMPLE ROULETTE
function isLong(i) {
  if (korg.read.sampleFrames(i) >= LONG_S * korg.read.sampleRate(i)) return 1;
  return 0;
}

function fits(i) {
  if (rLo == 0) return 1;                           // the waveforms have no frames and are always there
  if (korg.read.sampleFrames(i) == 0) return 0;     // an empty slot
  if (rLo < 500) return 1;
  if (isLong(i) == rLong) return 1;
  return 0;
}

// From a random slot of the category upwards, around its end, to the first slot that fits. Audio In (two slots without
// frames) and the unused slots 422 to 500 find nothing.
function spin() {
  if (rLeft == 0) return;
  let n = 0;
  while (rLeft > 0 && n < PROBES) {
    if (rPos != rCur && fits(rPos) == 1) {
      rLeft = 0;
      korg.seq.setPartValue(rPart, 0, rPos);
      if (korg.parts[rPart].sample != rPos) say(14, 0, 0);
      return;
    }
    rPos += 1;
    if (rPos >= rHi) rPos = rLo;
    rLeft -= 1;
    n += 1;
  }
  if (rLeft > 0) { later(); return; }
  say(6, 0, 0);
}

function roulette() {
  rLeft = 0;
  const part = korg.read.part();
  if (part > 15) { say(7, 0, 0); return; }
  const cur = korg.parts[part].sample;
  if (cur > 998) return;   // no slot: nothing to compare with
  let c = 0;
  while (c < 18 && cur >= CAT[c + 1]) c += 1;
  rPart = part;
  rCur = cur;
  rLo = CAT[c];
  rHi = CAT[c + 1];
  if (rLo >= 500) rLong = isLong(cur);
  rPos = rLo + rnd(rHi - rLo);
  rLeft = rHi - rLo;
  spin();
}

// ---- PARTY LOCK
function snapStep() {
  let n = 0;
  while (snapPos < 16 && n < 4) {
    for (let k = 0; k < 5; k++) snap[snapPos * 5 + k] = korg.read.patternValue(-1, snapPos, ENC[k]);
    snapPos += 1;
    n += 1;
  }
  if (snapPos < 16) { later(); return; }
  snapOk = 1;
}

function snapStart() {
  if (locked == 0) return;
  snapOk = 0;
  snapPos = 0;
  later();
}

// An encoder cannot be kept from the firmware, so what it changed on the selected part is put back.
function fix() {
  fixArmed = 0;
  if (locked == 0 || snapOk == 0) return;
  const p = korg.read.part();
  if (p > 15) return;
  for (let k = 0; k < 5; k++) {
    const v = snap[p * 5 + k];
    if (korg.read.patternValue(-1, p, ENC[k]) != v) korg.seq.setPartValue(p, ENC[k], v);
  }
}

function blinker() {
  if (locked == 0) return;
  blink = 1 - blink;
  korg.led(korg.led.EXIT, blink * 255);
}

function lockToggle() {
  if (lockArmed == 0) return;
  lockArmed = 0;
  locked = 1 - locked;
  if (locked == 1) {
    sceneArmed = 0;
    dropUp();
    for (let k = 0; k < 11; k++) korg.knobHold(k, 1);
    // the main dial: Korg's own PTN. CHANGE LOCK (the dial then needs SHIFT, which is locked)
    pcl = korg.global.patternChangeLock;
    korg.global.patternChangeLock = 1;
    korg.store.set(6, pcl + 1);
    // SEQUENCER, PART ERASE or PATTERN SET would let a pad change the set
    if (padSafe == 0) { korg.pressKey(korg.key.TRIGGER); padSafe = 1; }
    korg.display.popups = 0;
    snapStart();
    blink = 1;
    korg.led(korg.led.EXIT, 255);
    blinkTimer = korg.every(BLINK_MS, blinker);
    say(1, 0, 0);
  } else {
    for (let k = 0; k < 11; k++) korg.knobHold(k, 0);
    korg.global.patternChangeLock = pcl;
    korg.store.set(6, 0);
    korg.display.popups = 1;
    snapPos = 16;
    korg.cancel(blinkTimer);
    korg.led(korg.led.EXIT, 0);
    say(2, 0, 0);
  }
  korg.store.save();
  mask();
}

// Which pad mode the firmware is in, as far as the keys tell.
function track(key) {
  if (key == korg.key.TRIGGER || key == korg.key.KEYBOARD || key == korg.key.CHORD) padSafe = 1;
  else if (key == korg.key.SEQUENCER || key == korg.key.PATTERN_SET || key == korg.key.STEP_JUMP || key == korg.key.PART_MUTE || key == korg.key.PART_ERASE) padSafe = 0;
}

// ---- MUTE SCENES
function sceneDown(n) {
  scene = n;
  sceneArmed = 1;
  korg.cancel(sceneTimer);
  sceneTimer = korg.after(SCENE_MS, sceneStore);
}

function sceneStore() {
  if (sceneArmed == 0) return;
  sceneArmed = 0;
  chanceFree();
  korg.store.set(scene, muteMask());
  korg.store.save();
  say(4, scene + 1, 0);
}

function sceneUp() {
  const n = scene;
  scene = -1;
  if (sceneArmed == 0) return;   // held long enough: it is stored
  sceneArmed = 0;
  korg.cancel(sceneTimer);
  const m = korg.store.get(n, -1);
  if (m < 0) { say(5, n + 1, 0); return; }
  chMine = 0;
  muteTo(m);
  say(3, n + 1, 0);
}

// ---- TEMPO RAMP: a step of tempo every 4 steps, counted only while the sequencer plays. A bar is the 16 steps of one of
// the keys 1 to 4, in a triplet beat 12.
function rampTick() {
  if (rampOn == 0 || rampBeat >= rampBeats) return;
  rampBeat += 1;
  let t = rampBase + rampUp * rampBeat / rampBeats;
  if (t > 3000) t = 3000;
  if (t != korg.read.tempo()) korg.tempo(t);
  if (rampBeat < rampBeats) rampTimer = korg.afterSteps(4, rampTick);
}

function ramp() {
  if (rampOn == 1) {
    rampOn = 0;
    korg.cancel(rampTimer);
    if (korg.read.tempo() != rampBase) korg.tempo(rampBase);
    say(12, 0, 0);
    return;
  }
  rampOn = 1;
  rampBase = korg.read.tempo();
  rampUp = rampBpm * 10;
  rampBeat = 0;
  rampBeats = rampBars * 4;
  if (triplets() == 1) rampBeats = rampBars * 3;
  rampTimer = korg.afterSteps(4, rampTick);
  say(11, rampBpm, rampBars);
}

// ---- BAR COPY: whole steps (on, gate, velocity, trigger, notes), as upstream's Step Copy; motion data stays.
// COPIES parts per frame, one copy after the other in the order they were asked for.
function copyPump() {
  let n = 0;
  while (n < COPIES) {
    if (cPart >= cEnd) {
      if (qLen == 0) return;
      const job = queue[qHead];
      qHead = (qHead + 1) % 4;
      qLen -= 1;
      cSrc = job & 3;
      cDst = (job >> 2) & 3;
      cPart = (job >> 4) & 15;
      cEnd = cPart + (job >> 8);
    }
    korg.read.patternBytes(steps, -1, 2096 + 816 * cPart + 192 * cSrc);
    korg.seq.writeSteps(steps, cPart, 16 * cDst);
    cPart += 1;
    n += 1;
  }
  if (cPart < cEnd || qLen > 0) later();
}

// The first key 1 to 4 while SHIFT is held is the source, every further one a target.
function barCopy(bar, all) {
  if (copySrc < 0) { copySrc = bar; return; }
  if (bar == copySrc || qLen == 4) return;
  const bars = korg.pattern.current.length;
  if (copySrc >= bars) { say(10, copySrc + 1, 0); return; }
  let first = 0;
  let count = 16;
  if (all == 1) {
    if (bar >= bars) korg.pattern.current.length = bar + 1;
  } else {
    first = korg.read.part();
    count = 1;
    if (first > 15) { say(7, 0, 0); return; }
    if (bar >= bars) { say(10, bar + 1, 0); return; }
  }
  queue[(qHead + qLen) % 4] = copySrc | (bar << 2) | (first << 4) | (count << 8);
  qLen += 1;
  later();   // the copy itself runs in work(), so never more than COPIES parts in a frame
  say(8 + all, copySrc + 1, bar + 1);
}

// ---- CHANCE
function chanceStep() {
  const part = korg.read.part();
  if (part > 15) { say(7, 0, 0); return; }
  if (chance[part] == 0) chParts += 1;
  chance[part] = (chance[part] + 1) % 4;
  if (chance[part] == 0) {
    chParts -= 1;
    if (((chMine >> part) & 1) == 1) {
      if (korg.read.mute(part) == 1) korg.mute(part, 0);
      chMine = chMine & ~(1 << part);
    }
  }
  say(13, part + 1, 100 - 25 * chance[part]);
}

// The plugin hears of a step up to 40 ms after it began, so it decides here about the step that comes next: a hit that is
// to be dropped finds its part muted, and the mute is taken back when that step has come. The mute is the user's own switch
// (a byte of the pattern in RAM), nothing else is written. A part the user muted himself is never opened.
korg.onEvent("step", () => {
  if (chParts == 0 || dropOn == 1) return;
  const bars = korg.pattern.current.length;
  let most = 16;
  if (triplets() == 1) most = 12;
  for (let p = 0; p < 16; p++) {
    if (chance[p] != 0) {
      let last = korg.parts[p].lastStep;
      if (last == 0 || last > most) last = most;
      const s = korg.read.step(p);
      let next = s + 1;
      if ((next & 15) == 0 || (next & 15) >= last) next = (((s >> 4) + 1) % bars) << 4;
      let drop = 0;
      if (korg.seq.getOn(p, next) == 1 && rnd(4) < chance[p]) drop = 1;
      if (drop == 1 && korg.read.mute(p) == 0) {
        korg.mute(p, 1);
        chMine = chMine | (1 << p);
      } else if (drop == 0 && ((chMine >> p) & 1) == 1) {
        if (korg.read.mute(p) == 1) korg.mute(p, 0);
        chMine = chMine & ~(1 << p);
      }
    }
  }
});

function work() {
  workArmed = 0;
  if (rLeft > 0) spin();
  if (mBusy == 1) mPump();
  if (cPart < cEnd || qLen > 0) copyPump();
  if (fixArmed == 1) fix();
  if (snapPos < 16) snapStep();
}

// ---- events
korg.onEvent("ready", () => {
  // switched off while locked: the firmware saved PTN. CHANGE LOCK as we had set it
  const v = korg.store.get(6, 0);
  if (v > 0) {
    korg.global.patternChangeLock = v - 1;
    korg.store.set(6, 0);
    korg.store.save();
  }
});

korg.onEvent("buttonPress", (key) => {
  if (key == korg.key.TOUCHPAD) return;   // a finger on the touchpad, no key
  if (key == korg.key.EXIT) { exitOn(); return; }
  if (key == korg.key.SHIFT) { shiftDown = 1; copySrc = -1; mask(); return; }
  const bar = key - BAR;   // 0 to 3 for the keys 1 to 4
  if (exitDown == 0) {
    if (locked == 1) return;
    if (shiftDown == 1 && bar >= 0 && bar < 4) barCopy(bar, 0);
    else track(key);
    return;
  }
  exitAt = korg.millis();
  if (key == korg.key.MFX_HOLD) {
    lockArmed = 1;
    korg.cancel(lockTimer);
    lockTimer = korg.after(LOCK_MS, lockToggle);
    return;
  }
  if (locked == 1) { exitOff(0); return; }
  if (bar >= 0 && bar < 4) {
    if (shiftDown == 1) barCopy(bar, 1);
    else sceneDown(bar);
    return;
  }
  // SHIFT + PART ERASE is the melody generator's, and any other key is somebody else's combination
  if (shiftDown == 1) { exitOff(0); return; }
  if (key == korg.key.PART_ERASE) roulette();
  else if (key == korg.key.PART_MUTE) dropDown();
  else if (key == korg.key.STEP_JUMP) ramp();
  else if (key == korg.key.MFX_SEND) chanceStep();
  else { track(key); exitOff(0); }
});

korg.onEvent("buttonRelease", (key) => {
  if (key == korg.key.EXIT) { exitOff(1); return; }
  if (key == korg.key.SHIFT) { shiftDown = 0; mask(); return; }
  if (key == korg.key.MFX_HOLD) { lockArmed = 0; korg.cancel(lockTimer); }
  else if (key == korg.key.PART_MUTE) dropUp();
  else if (scene >= 0 && key - BAR == scene) sceneUp();
});

// Our text was closed: on the main screen that is an EXIT press, which the device does not report.
korg.onEvent("close", () => {
  msgOn = 0;
  korg.cancel(msgTimer);
  msgTimer = -1;
  exitOn();
});

korg.onEvent("encoder", (index) => {
  if (locked == 1 && index > 0) { fixArmed = 1; later(); }
});

korg.onEvent("stop", () => { chanceFree(); });

// The new pattern has its own mutes, steps and tempo: nothing of the old one is carried on into it.
korg.onEvent("patternChange", () => {
  dropOn = 0;
  mBusy = 0;
  chMine = 0;
  cPart = cEnd;
  qLen = 0;
  rLeft = 0;
  if (rampOn == 1 && korg.global.tempoLock == 0) { rampOn = 0; korg.cancel(rampTimer); }
  if (locked == 1) {
    snapOk = 0;
    korg.cancel(snapTimer);
    snapTimer = korg.after(SNAP_MS, snapStart);
  }
});

korg.onEvent("menu", (id, value) => {
  if (id == pgBpm) { rampBpm = value; korg.store.set(4, value); }
  else if (id == pgBars) { rampBars = value; korg.store.set(5, value); }
  else return;
  korg.store.save();
});
