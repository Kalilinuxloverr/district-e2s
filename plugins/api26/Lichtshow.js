// Lichtshow:
// Display-Licht,
// untere RGB-LEDs,
// Partymodus und
// Boot-Welle.
//
// STATUS: das Display
// zeigt, was los ist.
// REC rot, Pattern
// nicht gespeichert
// orange. Wartet ein
// Patternwechsel,
// blinkt es. Sonst
// deine Farbe.
//
// PART BLITZ: das
// Display blitzt in
// der Farbe des Parts,
// der gerade
// anschlaegt. Jeder
// der 16 Parts hat
// seine Farbe.
//
// PATTERN: jedes
// Pattern hat seine
// eigene Farbe.
//
// Party nimmt alle
// LEDs und das Licht.
// Nach dem Einschalten
// ist Party aus.
//
// BOOT WAVE: Welle
// ueber alle LEDs beim
// Start.
//
// SPEED 1 bis 10, HELL
// 1 bis 15. Laeuft der
// Sequencer, geht
// alles im Beat.
// DISPLAY SPEED stellt
// bei STATUS das
// Blinken und bei PART
// BLITZ die Dauer des
// Blitzes.
//
// [WERTE]
//
// DISPLAY MODE: 0=AUS
// 1=FADE 2=BEAT
// 3=GRUEN 4=PULS
// 5=STROBE 6=STATUS
// 7=PART BLITZ
// 8=PATTERN
//
// UNTEN MODE: 0=NORMAL
// 1=FADE 2=BEAT 3=PULS
// 4=METER BUNT
// 5=LAUFLICHT
//
// PARTY MODE: 0=AUS
// 1=FADE 2=STROBE
// 3=LAUFLICHT 4=CHAOS
//
// BOOT WAVE: 0=AUS
// 1=AN

// Needs DISTRICT (API 26): korg.backlightLevel and korg.bottomLed write the light directly and cheaply; turning a mode
// off gives the light back with the release calls, the user's saved colours are never changed.
// store: 0 display mode, 1 display speed, 2 bright, 3 bottom mode, 4 bottom speed, 5 boot wave, 6 party speed,
// 10-12 the user's own bottom LED mode and meter colours while UNTEN MODE 4 runs, 14 = 1 while those are kept
// [WERTE] The names of the mode values stand over their page, the same as in the table of the description. Once the
// firmware lets a page show text, they go into the page from here.
let dMode = korg.store.get(0, 1);
let dSpeed = korg.store.get(1, 3);
let bright = korg.store.get(2, 15);
let uMode = korg.store.get(3, 0);
let uSpeed = korg.store.get(4, 3);
let pMode = 0;
let pSpeed = korg.store.get(6, 5);
// DISPLAY MODE: 0=AUS 1=FADE 2=BEAT 3=GRUEN 4=PULS 5=STROBE 6=STATUS 7=PART BLITZ 8=PATTERN
let pgDMode = korg.menu.add("DISPLAY MODE", 0, 8, dMode);
let pgDSpeed = korg.menu.add("DISPLAY SPEED", 1, 10, dSpeed);
let pgBright = korg.menu.add("HELL", 1, 15, bright);
// UNTEN MODE: 0=NORMAL 1=FADE 2=BEAT 3=PULS 4=METER BUNT 5=LAUFLICHT
let pgUMode = korg.menu.add("UNTEN MODE", 0, 5, uMode);
let pgUSpeed = korg.menu.add("UNTEN SPEED", 1, 10, uSpeed);
// PARTY MODE: 0=AUS 1=FADE 2=STROBE 3=LAUFLICHT 4=CHAOS
let pgPMode = korg.menu.add("PARTY MODE", 0, 4, 0);
let pgPSpeed = korg.menu.add("PARTY SPEED", 1, 10, pSpeed);
// BOOT WAVE: 0=AUS 1=AN
let pgBoot = korg.menu.add("BOOT WAVE", 0, 1, korg.store.get(5, 1));
// API 27: all pages sit in BLECH -> CUSTOMIZATION, the modes show their names.
korg.menu.group(pgDMode, "CUSTOMIZATION");
korg.menu.group(pgDSpeed, "CUSTOMIZATION");
korg.menu.group(pgBright, "CUSTOMIZATION");
korg.menu.group(pgUMode, "CUSTOMIZATION");
korg.menu.group(pgUSpeed, "CUSTOMIZATION");
korg.menu.group(pgPMode, "CUSTOMIZATION");
korg.menu.group(pgPSpeed, "CUSTOMIZATION");
korg.menu.group(pgBoot, "CUSTOMIZATION");
function dText(v) {
  if (v == 0) korg.menu.text(pgDMode, "AUS");
  else if (v == 1) korg.menu.text(pgDMode, "FADE");
  else if (v == 2) korg.menu.text(pgDMode, "BEAT");
  else if (v == 3) korg.menu.text(pgDMode, "GRUEN");
  else if (v == 4) korg.menu.text(pgDMode, "PULS");
  else if (v == 5) korg.menu.text(pgDMode, "STROBE");
  else if (v == 6) korg.menu.text(pgDMode, "STATUS");
  else if (v == 7) korg.menu.text(pgDMode, "PART BLITZ");
  else if (v == 8) korg.menu.text(pgDMode, "PATTERN");
  return 0;
}
function uText(v) {
  if (v == 0) korg.menu.text(pgUMode, "NORMAL");
  else if (v == 1) korg.menu.text(pgUMode, "FADE");
  else if (v == 2) korg.menu.text(pgUMode, "BEAT");
  else if (v == 3) korg.menu.text(pgUMode, "PULS");
  else if (v == 4) korg.menu.text(pgUMode, "METER BUNT");
  else if (v == 5) korg.menu.text(pgUMode, "LAUFLICHT");
  return 0;
}
function pText(v) {
  if (v == 0) korg.menu.text(pgPMode, "AUS");
  else if (v == 1) korg.menu.text(pgPMode, "FADE");
  else if (v == 2) korg.menu.text(pgPMode, "STROBE");
  else if (v == 3) korg.menu.text(pgPMode, "LAUFLICHT");
  else if (v == 4) korg.menu.text(pgPMode, "CHAOS");
  return 0;
}
function bText(v) {
  if (v == 0) korg.menu.text(pgBoot, "AUS");
  else if (v == 1) korg.menu.text(pgBoot, "AN");
  return 0;
}
dText(dMode);
uText(uMode);
pText(0);
bText(korg.store.get(5, 1));

let cr = 0;
let cg = 0;
let cb = 0;
let beatNow = 0;
let stepNow = 0;
let boot = 0;
let dHue16 = 0;
let dTarget = 0;
let dEnv = 15;
let dBreath = 0;
let dFlash = 0;
let dTick = 0;
// DISPLAY MODE 6 to 8 set the light only when it has to change. sShown is what they last put there: -1 not known (after
// another mode, the party or the boot wave), 0 the user's own colour, above 0 a colour of the mode (STATUS 1 red, 2 orange,
// 3 dark; PART BLITZ the part + 1; PATTERN the pattern + 1).
let sShown = -1;
let sTick = 0;
let fPart = -1;
let fLeft = 0;
let padPlays = 1;
let uHue16 = 768;
let uTarget = 48;
let uEnv = 15;
let uBreath = 0;
let uPos = 0;
let uTick = 0;
let pHue16 = 0;
let pPhase = 0;
let pFlash = 0;
let pTick = 0;
let pPos = 0;
let seed = 12345;

// colour wheel 0..95 like BACKLIGHT HUE (six sectors of 16), scaled to brightness b (0..15), into cr, cg, cb
function hueRgb(h, b) {
  const s = h / 16;
  const f = h % 16;
  let r = 15;
  let g = 0;
  let bl = 0;
  if (s == 0) { g = f; }
  else if (s == 1) { r = 15 - f; g = 15; }
  else if (s == 2) { r = 0; g = 15; bl = f; }
  else if (s == 3) { r = 0; g = 15 - f; bl = 15; }
  else if (s == 4) { r = f; bl = 15; }
  else { bl = 15 - f; }
  cr = r * b / 15;
  cg = g * b / 15;
  cb = bl * b / 15;
  return 0;
}

function tri(a) {
  if (a < 256) return a;
  return 511 - a;
}

function rnd(n) {
  seed = seed * 1103515245 + 12345;
  return ((seed >> 16) & 32767) % n;
}

// all four bottom LEDs in the colour cr, cg, cb (0..15 each)
function bottomAll() {
  let n = 0;
  while (n < 4) { korg.bottomLed(n, cr * 17, cg * 17, cb * 17); n += 1; }
  return 0;
}

// UNTEN MODE 4: BLECHTRIBE's own level meter with its rainbow colours; the user's settings come back when the mode ends
function meterOn() {
  if (korg.store.get(14, 0) == 0) {
    korg.store.set(10, korg.menu.blech.customizations.led.mode);
    korg.store.set(11, korg.menu.blech.customizations.led.meter.still);
    korg.store.set(12, korg.menu.blech.customizations.led.meter.loud);
    korg.store.set(14, 1);
  }
  korg.bottomRelease();
  korg.menu.blech.customizations.led.mode = 0;
  korg.menu.blech.customizations.led.meter.still = 8;
  korg.menu.blech.customizations.led.meter.loud = 8;
  return 0;
}

function meterOff() {
  if (korg.store.get(14, 0) == 0) return 0;
  korg.menu.blech.customizations.led.mode = korg.store.get(10, 0);
  korg.menu.blech.customizations.led.meter.still = korg.store.get(11, 0);
  korg.menu.blech.customizations.led.meter.loud = korg.store.get(12, 0);
  korg.store.set(14, 0);
  return 0;
}

// STATUS: REC ready or recording red, an unsaved pattern orange, else the user's own colour. While a pattern change waits
// for the end of the sequence the light blinks dark, 12 - DISPLAY SPEED frames dark and as many in the state's colour.
function status() {
  let want = 0;
  if (korg.read.transport() >= 3) want = 1;
  else if (korg.read.unsaved() == 1) want = 2;
  // [SPAETER] Here: Audio In on in a colour of its own (want = 4), and a weak battery as a red pulse. API 26 has no call
  // that reads either; the two states go between the lines above and the blink below.
  if (korg.read.nextPattern() >= 0) {
    const half = 12 - dSpeed;
    if (sTick < half) want = 3;
    sTick += 1;
    if (sTick >= 2 * half) sTick = 0;
  }
  else sTick = 0;
  if (want == sShown) return 0;
  sShown = want;
  if (want == 0) korg.backlightRelease();
  else if (want == 1) korg.backlightLevel(bright, 0, 0);
  else if (want == 2) korg.backlightLevel(bright, (bright + 2) / 3, 0);
  else korg.backlightLevel(0, 0, 0);
  return 0;
}

// PART BLITZ: the light flashes in the colour of the part that strikes, then goes back to the user's own colour. A part
// strikes when the sequencer reaches a step of it that is on (the lowest part wins, a muted part does not count) or when
// its pad is hit (fPart, from the pad handler). The 16 colours lie 42 steps apart on the wheel of 96, so neighbours differ.
// The flash lasts 1 to 5 frames, shorter with DISPLAY SPEED.
function flash() {
  if (stepNow == 1 && fPart < 0) {
    let i = 0;
    while (i < 16) {
      if (korg.seq.getOn(i, korg.read.step(i))) {
        if (korg.read.mute(i) == 0) { fPart = i; break; }
      }
      i += 1;
    }
  }
  if (fPart >= 0) {
    // a part that strikes again while its flash still shows only makes the flash last longer
    if (sShown != fPart + 1) {
      hueRgb((fPart * 42) % 96, bright);
      korg.backlightLevel(cr, cg, cb);
      sShown = fPart + 1;
    }
    fLeft = 1 + ((10 - dSpeed) >> 1);
    fPart = -1;
  }
  else {
    if (fLeft > 0) fLeft -= 1;
    if (fLeft == 0 && sShown != 0) { korg.backlightRelease(); sShown = 0; }
  }
  return 0;
}

// PATTERN: every pattern has its colour, 37 steps on the wheel of 96 from its neighbour's
function patternColour() {
  const p = korg.read.pattern();
  if (p + 1 == sShown) return 0;
  sShown = p + 1;
  hueRgb((p * 37) % 96, bright);
  korg.backlightLevel(cr, cg, cb);
  return 0;
}

function display(playing) {
  if (dMode == 0) return 0;
  if (dMode > 5) {
    if (dMode == 6) status();
    else if (dMode == 7) flash();
    else patternColour();
    return 0;
  }
  dHue16 = (dHue16 + dSpeed * dSpeed) % 1536;
  if (dMode == 1) { hueRgb(dHue16 / 16, bright); }
  else if (dMode == 2) {
    // BEAT: one of six colours, a hard jump on every beat; stopped, a jump by SPEED. A glide to the next colour looked like
    // FADE at Hardtekk tempo (seen on the device 2026-11-13).
    if (playing == 1) { if (beatNow == 1) dTarget = (dTarget + 16) % 96; }
    else {
      dTick += 1;
      if (dTick >= 26 - 2 * dSpeed) { dTick = 0; dTarget = (dTarget + 16) % 96; }
    }
    hueRgb(dTarget, bright);
  }
  else if (dMode == 3) { cr = 0; cg = bright; cb = 0; }
  else if (dMode == 4) {
    // PULS: with the sequencer a hit on every beat that fades, without it a slow breath
    dBreath = (dBreath + dSpeed * 4) % 512;
    if (playing == 1) {
      if (beatNow == 1) { dEnv = 15; }
      else if (dEnv > 2) { dEnv -= 1; }
    } else { dEnv = 2 + 13 * tri(dBreath) / 255; }
    hueRgb(dHue16 / 16, dEnv * bright / 15);
  }
  else {
    if (playing == 1) { if (beatNow == 1) dFlash = 2; }
    else {
      dTick += 1;
      if (dTick >= 26 - 2 * dSpeed) { dTick = 0; dFlash = 2; }
    }
    if (dFlash > 0) { dFlash -= 1; cr = bright; cg = bright; cb = bright; }
    else { hueRgb(dHue16 / 16, 1); }
  }
  korg.backlightLevel(cr, cg, cb);
  return 0;
}

function bottom(playing) {
  if (uMode == 0 || uMode == 4) return 0;
  uHue16 = (uHue16 + uSpeed * uSpeed) % 1536;
  if (uMode == 1) { hueRgb(uHue16 / 16, 15); bottomAll(); }
  else if (uMode == 2) {
    // BEAT: all four LEDs one of six colours, a hard jump on every beat; stopped, a jump by SPEED (as DISPLAY BEAT)
    if (playing == 1) { if (beatNow == 1) uTarget = (uTarget + 16) % 96; }
    else {
      uTick += 1;
      if (uTick >= 26 - 2 * uSpeed) { uTick = 0; uTarget = (uTarget + 16) % 96; }
    }
    hueRgb(uTarget, 15);
    bottomAll();
  }
  else if (uMode == 3) {
    uBreath = (uBreath + uSpeed * 4) % 512;
    if (playing == 1) {
      if (beatNow == 1) { uEnv = 15; }
      else if (uEnv > 1) { uEnv -= 1; }
    } else { uEnv = 1 + 14 * tri(uBreath) / 255; }
    hueRgb(uHue16 / 16, uEnv);
    bottomAll();
  }
  else {
    // LAUFLICHT: one LED bright with a dim tail, a step on every beat or by SPEED
    if (playing == 1) { if (beatNow == 1) uPos = (uPos + 1) % 4; }
    else {
      uTick += 1;
      if (uTick >= 14 - uSpeed) { uTick = 0; uPos = (uPos + 1) % 4; }
    }
    let n = 0;
    while (n < 4) {
      if (n == uPos) { hueRgb(uHue16 / 16, 15); }
      else if (n == (uPos + 3) % 4) { hueRgb(uHue16 / 16, 3); }
      else { cr = 0; cg = 0; cb = 0; }
      korg.bottomLed(n, cr * 17, cg * 17, cb * 17);
      n += 1;
    }
  }
  return 0;
}

// with korg.ledHold the four bottom LEDs are 76 + 3 * n + (0 red, 1 green, 2 blue); levels 0..255
function heldBottom(n, h, b) {
  hueRgb(h, b);
  korg.led(76 + 3 * n, cr * 17);
  korg.led(77 + 3 * n, cg * 17);
  korg.led(78 + 3 * n, cb * 17);
  return 0;
}

function pads(red, blue) {
  let i = 0;
  while (i < 16) {
    korg.led(44 + 2 * i, red);
    korg.led(45 + 2 * i, blue);
    i += 1;
  }
  return 0;
}

function party(playing) {
  pHue16 = (pHue16 + pSpeed * pSpeed) % 1536;
  const h = pHue16 / 16;
  let i = 0;
  if (pMode == 1) {
    pPhase = (pPhase + pSpeed * 3) % 512;
    while (i < 16) {
      const a = (pPhase + i * 32) % 512;
      korg.led(44 + 2 * i, tri(a));
      korg.led(45 + 2 * i, tri((a + 256) % 512));
      i += 1;
    }
    i = 0;
    while (i < 4) { heldBottom(i, (h + i * 24) % 96, 15); i += 1; }
    hueRgb(h, bright);
    korg.backlightLevel(cr, cg, cb);
  }
  else if (pMode == 2) {
    if (playing == 1) { if (beatNow == 1) pFlash = 2; }
    else {
      pTick += 1;
      if (pTick >= 26 - 2 * pSpeed) { pTick = 0; pFlash = 2; }
    }
    if (pFlash > 0) {
      pFlash -= 1;
      pads(255, 255);
      while (i < 4) { heldBottom(i, h, 15); i += 1; }
      korg.backlightLevel(bright, bright, bright);
    } else {
      pads(0, 0);
      while (i < 4) { heldBottom(i, h, 0); i += 1; }
      korg.backlightLevel(0, 0, 0);
    }
  }
  else if (pMode == 3) {
    let move = 0;
    if (playing == 1) { move = stepNow; }
    else {
      pTick += 1;
      if (pTick >= 12 - pSpeed) { pTick = 0; move = 1; }
    }
    if (move == 1) pPos = (pPos + 1) % 16;
    while (i < 16) {
      let lv = 0;
      if (i == pPos) { lv = 255; }
      else if (i == (pPos + 15) % 16) { lv = 60; }
      if ((pPos / 4) % 2 == 0) { korg.led(44 + 2 * i, lv); korg.led(45 + 2 * i, 0); }
      else { korg.led(44 + 2 * i, 0); korg.led(45 + 2 * i, lv); }
      i += 1;
    }
    i = 0;
    while (i < 4) {
      if (i == pPos % 4) { heldBottom(i, h, 15); }
      else { heldBottom(i, h, 0); }
      i += 1;
    }
    hueRgb((pPos / 4) * 24, bright);
    korg.backlightLevel(cr, cg, cb);
  }
  else {
    pTick += 1;
    let k = 0;
    while (k < 3) {
      const p = rnd(16);
      korg.led(44 + 2 * p, rnd(2) * 255);
      korg.led(45 + 2 * p, rnd(2) * 255);
      k += 1;
    }
    if (pTick % 3 == 0) { while (i < 4) { heldBottom(i, rnd(96), 15); i += 1; } }
    if ((playing == 1 && beatNow == 1) || (playing == 0 && pTick % (26 - 2 * pSpeed) == 0)) {
      hueRgb(rnd(96), bright);
      korg.backlightLevel(cr, cg, cb);
    }
  }
  return 0;
}

// BOOT WAVE: 32 frames after the start; one bright pad with a tail runs over the 16 pads, the bottom LEDs follow,
// the display light goes once round the colour wheel. At most 12 LED messages a frame (the device takes 16).
function wave(t) {
  const p = t / 2;
  if (p < 16) {
    korg.led(44 + 2 * p, 255);
    korg.led(45 + 2 * p, 255);
  }
  if (p >= 1 && p <= 16) { korg.led(44 + 2 * (p - 1), 70); korg.led(45 + 2 * (p - 1), 0); }
  if (p >= 2 && p <= 17) { korg.led(44 + 2 * (p - 2), 0); korg.led(45 + 2 * (p - 2), 0); }
  const b = (t / 8) % 4;
  let n = 0;
  while (n < 4) {
    if (n == b) { heldBottom(n, (t * 3) % 96, 15); }
    else if (n == (b + 3) % 4) { heldBottom(n, 0, 0); }
    n += 1;
  }
  hueRgb((t * 3) % 96, 15);
  korg.backlightLevel(cr, cg, cb);
  return 0;
}

korg.onEvent("ready", () => {
  if (uMode == 4) meterOn();
  if (korg.store.get(5, 1) == 1) { boot = 1; korg.ledHold(1); }
});

korg.onEvent("beat", () => { beatNow = 1; });
korg.onEvent("step", () => { stepNow = 1; });

// PART BLITZ: a pad that is hit. What a pad plays is not readable, so the pad mode is followed by its keys, which stay on
// after they are let go (measured upstream, docs/tastenkombinationen.md): in TRIGGER a pad plays its own part, in KEYBOARD
// and CHORD the selected part, in SEQUENCER, STEP JUMP and PATTERN SET none. PART MUTE and PART ERASE change nothing here:
// with SHIFT they are other functions.
korg.onEvent("buttonPress", (key) => {
  if (key == korg.key.TRIGGER) padPlays = 1;
  else if (key == korg.key.KEYBOARD || key == korg.key.CHORD) padPlays = 2;
  else if (key == korg.key.SEQUENCER || key == korg.key.STEP_JUMP || key == korg.key.PATTERN_SET) padPlays = 0;
});

korg.onEvent("pad", (index, down) => {
  if (down == 0 || padPlays == 0) return;
  if (padPlays == 1) fPart = index;
  else fPart = korg.read.part();
  if (fPart > 15) fPart = -1;
});

korg.onEvent("menu", (id, value) => {
  if (id == pgDMode) {
    dMode = value;
    sShown = -1;
    fPart = -1;
    fLeft = 0;
    if (dMode == 0 && pMode == 0) korg.backlightRelease();
    dText(dMode);
    korg.store.set(0, dMode);
  }
  else if (id == pgDSpeed) { dSpeed = value; korg.store.set(1, value); }
  else if (id == pgBright) { bright = value; sShown = -1; korg.store.set(2, value); }
  else if (id == pgUMode) {
    if (uMode == 4 && value != 4) meterOff();
    uMode = value;
    if (uMode == 0) korg.bottomRelease();
    if (uMode == 4) meterOn();
    uText(uMode);
    korg.store.set(3, uMode);
  }
  else if (id == pgUSpeed) { uSpeed = value; korg.store.set(4, value); }
  else if (id == pgPMode) {
    if (pMode == 0 && value != 0) korg.ledHold(1);
    if (pMode != 0 && value == 0) {
      korg.ledHold(0);
      if (dMode == 0) korg.backlightRelease();
      sShown = -1;
    }
    pMode = value;
    pText(value);
  }
  else if (id == pgPSpeed) { pSpeed = value; korg.store.set(6, value); }
  else if (id == pgBoot) { bText(value); korg.store.set(5, value); }
  korg.store.save();
});

korg.onEvent("frame", () => {
  let playing = 0;
  if (korg.read.transport() == 1) playing = 1;
  if (boot > 0) {
    wave(boot - 1);
    boot += 1;
    if (boot > 36) {
      boot = 0;
      if (pMode == 0) korg.ledHold(0);
      if (dMode == 0) korg.backlightRelease();
    }
  }
  else if (pMode != 0) { party(playing); }
  else {
    display(playing);
    bottom(playing);
  }
  beatNow = 0;
  stepNow = 0;
});
