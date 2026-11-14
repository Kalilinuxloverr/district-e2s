// AUTO BPM wie in der
// iPad-App: EXIT halten
// und TAP druecken
// setzt das Tempo so,
// dass das Sample des
// Parts bis zum
// naechsten Trigger
// klingt. Pitch nur,
// wenn sonst nicht 145
// bis 200 BPM (+-6).
// Nochmal: aus.

// Needs DISTRICT (API 26): length, rate and tune come from the firmware's own sample tables, so they are always current.
// 2^(i/12) * 1024
const RF = [1024, 1085, 1149, 1218, 1290, 1367, 1448, 1534, 1625, 1722, 1825, 1933];
// steps per beat for BEAT 16, 32, 8 Tri, 16 Tri, 8 (BLECHTRIBE)
const DEN = [4, 8, 3, 6, 2];
const LO = 1450;
const HI = 2000;
const NONE = -100;

let exitDown = 0;
let exitTimer = -1;
// A text asked for while EXIT is down: on the device a plugin that owns the display hears neither EXIT's press nor its
// release (script_hooks.s, input_button), so the text waits for the release, or for EXIT_MS without one.
let pending = -1;
let pendingBpm = 0;
let pendingPitch = 0;
const EXIT_MS = 5000;
let on = 0;
let fitPart = 0;
let fitPattern = 0;
let fitTempo = 0;
let base = 0;
let semi0 = 0;
let den = 4;
let follow = 0;
let msgTimer = -1;
let lastSlot = 0;

function ab(x) {
  if (x < 0) return 0 - x;
  return x;
}

// Reads the part once: 0 ok, 1 no sample there, 2 no trigger, 3 far too short, 4 an oscillator. Sets base, semi0 and den.
function prep(part) {
  const slot = korg.parts[part].sample;
  lastSlot = slot;
  if (slot >= 0 && slot < 18) return 4;
  const frames = korg.read.sampleFrames(slot);
  const rate = korg.read.sampleRate(slot);
  if (frames < 2 || rate < 1) return 1;
  // K = 6000 * rate / frames: BPM x 100 when the whole sample is one beat; in two parts, 6000 * rate alone can overflow
  const k = (600 * rate / frames) * 10 + ((600 * rate) % frames) * 10 / frames;
  if (k < 1) return 1;
  let last = korg.parts[part].lastStep;
  if (last == 0) last = 16;
  const cycle = last * korg.pattern.current.length;
  let first = -1;
  let second = -1;
  let n = 0;
  while (n < cycle && second < 0) {
    if (korg.seq.getOn(part, (n / last) * 16 + n % last) == 1) {
      if (first < 0) { first = n; } else { second = n; }
    }
    n += 1;
  }
  if (first < 0) return 2;
  let steps = cycle;
  if (second >= 0) steps = second - first;
  let note = korg.seq.getNote(part, (first / last) * 16 + first % last, 0);
  if (note < 0) note = 60;
  semi0 = note - 60 + korg.read.sampleTune(slot);
  // OSC EDIT moves the start into the first half (64 and up: reverse), so only (126 - e) / 126 of the sample plays
  let e = korg.parts[part].oscEdit;
  if (e >= 64) e -= 64;
  if (e > 63) e = 63;
  if (k > 16000000 / steps) return 3;
  base = steps * k;
  base = base * 126 / (126 - e);
  let beat = korg.pattern.current.beat;
  if (beat < 0 || beat > 4) beat = 0;
  den = DEN[beat];
  return 0;
}

// Tempo in tenths (floored) for prep()'s part at pitch p.
function bpmFor(p) {
  let s = semi0 + p;
  let oct = 0;
  while (s < 0) { s += 12; oct -= 1; }
  while (s >= 12) { s -= 12; oct += 1; }
  let t = (base / 1024) * RF[s] + (base % 1024) * RF[s] / 1024;
  while (oct > 0) {
    if (t > 500000000) return 99999;
    t = t * 2;
    oct -= 1;
  }
  while (oct < 0) { t = t / 2; oct += 1; }
  return t / (den * 10);
}

// code: 0 tempo set, 1 off, 2 no sample, 3 no trigger, 4 too long, 5 too short, 6 no single part, 7 oscillator
function say(code, bpm, pitch) {
  if (exitDown == 1) { pending = code; pendingBpm = bpm; pendingPitch = pitch; return; }
  show(code, bpm, pitch);
}

function show(code, bpm, pitch) {
  if (korg.display.take() != 1) return;
  korg.display.clear();
  if (code == 0) {
    korg.display.text("AUTO BPM", 4, 12);
    korg.display.textNumber("", bpm / 10, 4, 28);
    let x = 16;
    if (bpm >= 1000) x = 22;
    korg.display.text(".", x, 28);
    korg.display.number(bpm % 10, x + 6, 28);
    if (pitch != 0) korg.display.textNumber("PITCH ", pitch, 4, 44);
  }
  else if (code == 1) { korg.display.text("AUTO BPM AUS", 4, 24); }
  else if (code == 2) { korg.display.textNumber("SLOT ", lastSlot + 1, 4, 16); korg.display.text("KEIN SAMPLE", 4, 32); }
  else if (code == 3) { korg.display.text("KEIN TRIGGER", 4, 24); }
  else if (code == 4) { korg.display.text("SAMPLE ZU LANG", 4, 24); }
  else if (code == 5) { korg.display.text("SAMPLE ZU KURZ", 4, 24); }
  else if (code == 7) { korg.display.text("OSZILLATOR, KEIN", 4, 20); korg.display.text("SAMPLE", 4, 32); }
  else { korg.display.text("EINEN PART WAEHLEN", 4, 24); }
  if (msgTimer >= 0) korg.cancel(msgTimer);
  msgTimer = korg.after(1500, () => { msgTimer = -1; korg.display.release(); });
}

// Tempo for pitch p when it lands in 145-200 BPM, else 0.
function tryPitch(p) {
  if (p < -6 || p > 6) return 0;
  const b = bpmFor(p);
  if (b >= LO && b <= HI) return b;
  return 0;
}

// Current pitch first, then -6..+6 nearest first (lower on a tie), as the app does.
function toggle() {
  if (on == 1) { on = 0; say(1, 0, 0); return; }
  const part = korg.read.part();
  if (part > 15) { say(6, 0, 0); return; }
  const r = prep(part);
  if (r == 1) { say(2, 0, 0); return; }
  if (r == 2) { say(3, 0, 0); return; }
  if (r == 3) { say(5, 0, 0); return; }
  if (r == 4) { say(7, 0, 0); return; }
  const now = korg.parts[part].pitch;
  let best = NONE;
  let bpm = bpmFor(now);
  if (bpm >= LO && bpm <= HI) best = now;
  let d = 0;
  while (best == NONE && d <= 6 + ab(now)) {
    let b = tryPitch(now - d);
    if (b > 0) { best = now - d; bpm = b; }
    else if (d > 0) {
      b = tryPitch(now + d);
      if (b > 0) { best = now + d; bpm = b; }
    }
    d += 1;
  }
  if (best == NONE) {
    if (bpmFor(6) < LO) { say(4, 0, 0); } else { say(5, 0, 0); }
    return;
  }
  if (best != now) korg.parts[part].pitch = best;
  korg.tempo(bpm);
  on = 1;
  fitPart = part;
  fitPattern = korg.read.pattern();
  fitTempo = bpm;
  say(0, bpm, best - now);
}

korg.onEvent("ready", () => { korg.display.popups = 0; });

// While EXIT is down TAP belongs to this plugin, so TAP MOTION and tap tempo do not see the press.
// EXIT let go, or EXIT_MS without its release: TAP is the firmware's again and a waiting text is shown.
function exitUp() {
  if (exitTimer >= 0) korg.cancel(exitTimer);
  exitTimer = -1;
  exitDown = 0;
  korg.keyHold(korg.key.TAP, 0);
  if (pending >= 0) { const c = pending; pending = -1; show(c, pendingBpm, pendingPitch); }
  return 0;
}

function exitArm() {
  if (exitTimer >= 0) korg.cancel(exitTimer);
  exitTimer = korg.after(EXIT_MS, () => { exitTimer = -1; exitUp(); });
  return 0;
}

korg.onEvent("buttonPress", (key) => {
  if (key == korg.key.EXIT) { exitDown = 1; korg.keyHold(korg.key.TAP, 1); exitArm(); }
  else if (key == korg.key.TAP && exitDown == 1) { exitArm(); toggle(); }
});
korg.onEvent("buttonRelease", (key) => {
  if (key == korg.key.EXIT) exitUp();
});

korg.onEvent("frame", () => {
  if (on == 0) return;
  follow += 1;
  if (follow < 6) return;
  follow = 0;
  // another pattern, or a tempo set by hand or by TAP, lets go (as in the app)
  if (korg.read.pattern() != fitPattern || korg.read.tempo() != fitTempo) { on = 0; return; }
  if (prep(fitPart) == 0) {
    const b = bpmFor(korg.parts[fitPart].pitch);
    if (b >= 100 && b <= 3000 && b != fitTempo) { korg.tempo(b); fitTempo = b; }
  }
});
