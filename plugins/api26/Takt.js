// TAKT-ZAEHLER: zeigt
// Takt und Schlag
// gross auf dem
// Display, daneben die
// Laenge des Patterns.
//
// Wartet ein
// Patternwechsel
// (NEXT), steht unten,
// welches Pattern
// kommt und in wie
// vielen Schlaegen.
//
// Oeffnen: MENU,
// BLECH, TOOLS,
// TAKT-ZAEHLER, ENTER.
// EXIT schliesst ihn,
// ein Menue auch. Alle
// Tasten spielen
// weiter wie sonst.
//
// Fuer ein Kuerzel mit
// EXIT (DROP, ROULETTE
// ...) EXIT danach
// noch einmal
// druecken: das erste
// EXIT schliesst nur
// den Zaehler.
//
// Keine Seiten, keine
// Werte.

// An app of its own, because an app cannot share a plugin with anything that takes the display for a text (Spielen.js).
// Closed it only looks at released keys. Open, `frame` reads the step of part 1 and the waiting pattern and draws only what
// changed: a digit, the length, the countdown.
// A bar is a group of 16 steps, as the keys 1 to 4 count them (with BEAT 32 and 16 Tri that is half a bar of music); how
// many steps make a beat follows the pattern's BEAT. The countdown runs to the end of the pattern (its LENGTH), where a
// confirmed pattern change (NEXT:, korg.read.nextPattern) starts. All of it follows part 1, whose LAST STEP should be 16.
korg.app("TAKT-ZAEHLER", "TOOLS");

// The keys that Spielen.js and AutoBPM.js use together with EXIT. EXIT closes this app, and the device reports that press to
// no plugin (tools/patch/script_hooks.s, input_button), so they do not know that EXIT is down and the key of a combination
// would reach the firmware as a plain key (EXIT + PART MUTE would switch the pads to PART MUTE). After a close these keys are
// kept from the firmware until EXIT comes up, 3 s at most (a menu closes the app too, and then no EXIT release follows).
const GUARD = (15 << korg.key.BAR_1) | (1 << korg.key.PART_ERASE) | (1 << korg.key.MFX_HOLD) | (1 << korg.key.PART_MUTE) | (1 << korg.key.STEP_JUMP) | (1 << korg.key.MFX_SEND) | (1 << korg.key.TAP);
let guard = 0;
let guardTimer = -1;

// the segments of the digits 0 to 9: bit 0 top, 1 right top, 2 right bottom, 3 bottom, 4 left bottom, 5 left top, 6 middle
const SEG = [0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F];
// steps to a beat for BEAT 16, 32, 8 Tri, 16 Tri and BLECHTRIBE's 8; the two triplet beats play 12 of a group's 16 steps
const DEN = [4, 8, 3, 6, 2];
let stage = 0;    // 0 the frame the app opened in (the keys cost enough there), 1 the names are to draw, 2 running
let step = -1;    // what the picture shows
let next = -2;
let sBar = 0;
let sBeat = 0;
let sLen = 0;
let sLeft = 0;

// A digit of 26 x 40 pixels with its left edge at x.
function digit(n, x) {
  korg.display.clearRect(x, 11, 26, 40);
  if (n < 0 || n > 9) return;
  const m = SEG[n];
  if ((m & 1) != 0) korg.display.rect(x, 11, 26, 5);
  if ((m & 2) != 0) korg.display.rect(x + 21, 11, 5, 20);
  if ((m & 4) != 0) korg.display.rect(x + 21, 31, 5, 20);
  if ((m & 8) != 0) korg.display.rect(x, 46, 26, 5);
  if ((m & 16) != 0) korg.display.rect(x, 31, 5, 20);
  if ((m & 32) != 0) korg.display.rect(x, 11, 5, 20);
  if ((m & 64) != 0) korg.display.rect(x, 28, 26, 5);
}

// An open app keeps the keys from the firmware. This one only shows something, so every key goes on to the firmware
// (EXIT closes the app, the firmware sees to that itself).
korg.onEvent("open", () => {
  for (let k = 0; k < 34; k++) {
    if (k != korg.key.EXIT) korg.passKeys(k, 1);
  }
  stage = 0;
});

function unguard() {
  if (guard == 0) return;
  guard = 0;
  korg.cancel(guardTimer);
  korg.keyMask(0, 0);
}

korg.onEvent("close", () => {
  guard = 1;
  korg.keyMask(GUARD, 0);
  guardTimer = korg.after(3000, unguard);
});

korg.onEvent("buttonRelease", (key) => {
  if (key == korg.key.EXIT) unguard();
});

korg.onEvent("frame", () => {
  if (stage == 0) { stage = 1; return; }
  if (stage == 1) {
    korg.display.text("TAKT", 6, 1);
    korg.display.text("SCHLAG", 46, 1);
    korg.display.rect(36, 46, 5, 5);
    step = -1;
    next = -2;
    sBar = 0;
    sBeat = 0;
    sLen = 0;
    stage = 2;
    return;
  }
  const s = korg.read.step(0);
  const nx = korg.read.nextPattern();
  if (s == step && nx == next) return;
  step = s;
  const len = korg.pattern.current.length;
  let b = korg.pattern.current.beat;
  if (b > 4) b = 0;
  let group = 16;
  if (b == 2 || b == 3) group = 12;
  let at = s & 15;
  if (at >= group) at = group - 1;
  const bar = (s >> 4) + 1;
  const beat = at / DEN[b] + 1;
  if (bar != sBar) { sBar = bar; digit(bar, 6); }
  if (beat != sBeat) { sBeat = beat; digit(beat, 46); }
  if (len != sLen) {
    sLen = len;
    korg.display.clearRect(88, 1, 36, 8);
    korg.display.textNumber("VON ", len, 88, 1);
  }
  if (nx != next) {
    next = nx;
    sLeft = 0;
    korg.display.clearRect(0, 55, 128, 8);
    if (nx >= 0) korg.display.textNumber("NEXT ", nx + 1, 4, 55);
  }
  if (nx < 0) return;
  // beats to the end of the pattern, 1 during the last one
  let left = ((len - bar) * group + group - 1 - at) / DEN[b] + 1;
  if (left < 1) left = 1;
  if (left != sLeft) {
    sLeft = left;
    korg.display.clearRect(58, 55, 70, 8);
    korg.display.textNumber("IN ", left, 58, 55);
  }
});
