"""Emulator cases of plugin API 26: korg.backlightLevel and korg.backlightRelease set the levels the software PWM of the display
light uses and give them back, korg.bottomLed and korg.bottomRelease keep a bottom LED on a plugin's colour against the meter's
round every 40 ms, korg.read.sampleFrames, sampleRate and sampleTune read the firmware's tables of a sample on the card,
korg.read.unsaved follows a step edit and korg.quickSave stores the pattern in its own place, also with the main dial turned
while the Write window is open, and does nothing in a wrong state. A plugin that stops gives the light and the LEDs back.

    PYTHONPATH=tools/patch python3 tools/emu/plugin_api26_cases.py --vsb PATCHED.VSB [--flash FLASH.BIN]

The measurements are in docs/messungen/2026-11-12-plugin-api26.md.
"""
import argparse
import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))

from tools.patch import script_hooks  # noqa: E402
import menu_cases  # noqa: E402
import plugin_edit_cases as edit  # noqa: E402
import sampleset  # noqa: E402
import script_cases  # noqa: E402
from firmware import identify  # noqa: E402
from machine import load_flash  # noqa: E402

STATE = script_hooks.MENU_STATE
LOOK = script_hooks.LOOK_HOLD        # the record of script_hw.s: LK_BL, LK_WANT at +12
BL_R, BL_ON, BL_PWM, BL_CLR = 0xB0, 0xC4, 0xC8, 0xD0     # M_BL_R (the colour of the settings, three words), M_BL_ON, M_BL_PWM, M_BL_CLR
SAVE_ON, SAVE_CLR = -0x18, -0x14     # MX_SAVE_ON, MX_SAVE_CLR: the light of power save
LED_EFF, LED_V = 0xBC, 0xC0          # M_LED_EFF, M_LED_V: the kind and the colour of the bottom LEDs of the settings
SC_SAVE = -0x03                      # frames left for the Write window to open (script_shortcuts.s)
META, PLAY, PERIOD = (script_hooks.SAMPLE_TABLES["stock"][k] for k in ("SMP_META", "SMP_PLAY", "SMP_PERIOD"))
REC, STOP, MENU, EXIT, WRITE, SEQUENCER = 0, 1, 9, 13, 14, 21
WINDOW = 18                          # the firmware's Write window
SAVE_S = 2.5                         # the window shows the save for a moment and leaves on its own
ARMED = 2                            # SCRIPT_STATE
OPS = {"level": 1, "lightBack": 2, "led": 3, "ledsBack": 4, "frames": 5, "rate": 6, "tune": 7, "save": 8, "ledHold": 9, "fault": 10}
PROGRAM = """let cmd = 0; let done = 0; let a = 0; let b = 0; let c = 0; let d = 0; let out = 0; let unsaved = 0;
korg.onEvent("frame", () => {
  unsaved = korg.read.unsaved();
  if (cmd == done) return;
  done = cmd;
  let op = cmd & 15;
  if (op == 1) korg.backlightLevel(a, b, c);
  if (op == 2) korg.backlightRelease();
  if (op == 3) korg.bottomLed(a, b, c, d);
  if (op == 4) korg.bottomRelease();
  if (op == 5) out = korg.read.sampleFrames(a);
  if (op == 6) out = korg.read.sampleRate(a);
  if (op == 7) out = korg.read.sampleTune(a);
  if (op == 8) out = korg.quickSave();
  if (op == 9) korg.ledHold(a);
  if (op == 10) out = 1 / (a - a);
});"""


def period_of(rate):
    """The playback period the firmware's export writes for a rate: 63132 - log2(rate) * 3072."""
    return round(63132 - math.log2(rate) * 3072)


# The samples of the card, by index (the slot minus 1): name, frames, the rate its record names, kind, what the record gets
# besides (the start point in bytes, the playback period, the tune), and what the three calls have to return.
SAMPLES = {
    500: ("plain", 2000, 48000, "pcm16", {"period": period_of(48000)}, (2000, 48000, 0)),
    501: ("start", 3000, 48000, "pcm16", {"start": 200, "period": period_of(48000)}, (2900, 48000, 0)),     # starts at frame 100
    502: ("stereo", 2000, 48000, "stereo16L", {"stereo": 1, "period": period_of(48000)}, (2000, 48000, 0)),
    503: ("tuned", 2500, 44100, "pcm16", {"period": period_of(44100), "tune": -5}, (2500, 44100, -5)),
    504: ("other", 2500, 32225, "pcm16", {"period": period_of(32058)}, (2500, 32058, 0)),                   # named 32225, plays at 32058
    505: ("slow", 2500, 24000, "pcm16", {"period": period_of(24000), "tune": 7}, (2500, 24000, 7)),
}
ESLI = {"start": (40, "<I"), "period": (34, "<H"), "tune": (77, "<b"), "stereo": (65, "<B")}


def bank():
    """e2sSample.all with the samples of SAMPLES, made from a formula (sampleset.py)."""
    table, body = [0] * sampleset.SLOTS, bytearray()
    for slot, (name, frames, rate, kind, record, _) in SAMPLES.items():
        wave = bytearray(sampleset.wav(slot, name, frames, rate, kind))
        at = wave.index(b"esli") + 8
        for field, value in record.items():
            struct.pack_into(ESLI[field][1], wave, at + ESLI[field][0], value)
        table[slot] = sampleset.HEADER + len(body)
        body += wave
    head = b"e2s sample all\x1a\0" + struct.pack(f"<{sampleset.SLOTS}I", *table)
    return head.ljust(sampleset.HEADER, b"\0") + bytes(body)


def node_requests():
    """Every answer this module asks Node for (node_json.py); tools/emu/node_results.py keeps them in its file."""
    edit.compiled({"api26": PROGRAM})


def entry(name, ok, detail):
    return {"id": f"plugin_api26:{name}", "ok": bool(ok), "detail": str(detail)}


class World:
    """A booted device on mains power with the plugin running; `call` has the plugin make one call and returns what it gave back."""

    def __init__(self, vsb, flash, built, programs, files=None, seconds=2.0):
        self.dev = menu_cases.boot(vsb[0x100:], flash, files={**menu_cases.CARD_FOLDER, **(files or {})}, adapter=True, seconds=seconds)
        self.at = script_cases.install(self.dev, built, programs, ["api26"])["api26"]
        self.program = programs["api26"]
        self.seq = 0
        self.dev.run(0.5)

    def vars(self):
        return script_cases.variables(self.dev, self.at, self.program)

    def poke(self, name, value):
        base = self.dev.u32(self.at + 8)
        self.dev.m.uc.mem_write(base + self.program["symbols"][name]["slot"] * 4, struct.pack("<i", value))

    def post(self, op, a=0, b=0, c=0, d=0):
        """The command is in the plugin's variables; its next frame runs it."""
        self.seq += 1
        for name, value in zip("abcd", (a, b, c, d)):
            self.poke(name, value)
        self.poke("cmd", self.seq * 16 + OPS[op])

    def call(self, op, a=0, b=0, c=0, d=0, wait=0.2):
        self.post(op, a, b, c, d)
        self.dev.run(wait)
        return self.vars()["out"]

    def state(self):
        """2 armed, 3 switched off after a fault (SCRIPT_STATE)."""
        return self.dev.u32(self.at + 12)

    # ---- the display light
    def light(self):
        """What the PWM hook reads: the pins that light, whether a level needs the PWM, the pins it clears at each of its 16 ticks."""
        return self.dev.u32(STATE + BL_ON), self.dev.u32(STATE + BL_PWM), self.dev.read(STATE + BL_CLR, 16).hex()

    def settings(self):
        """What a plugin must leave alone: the colour of the settings and the light of power save."""
        return self.dev.read(STATE + BL_R, 12).hex(), self.dev.read(STATE + SAVE_ON, 1).hex(), self.dev.read(STATE + SAVE_CLR, 16).hex()

    # ---- the bottom LEDs
    def leds(self, wait=0.3):
        """The twelve channels after some rounds of the meter, as the panel got them last, and the messages it got for each LED."""
        self.dev.m.panel_log.clear()
        self.dev.run(wait)
        sent = [sum(1 for m in self.dev.m.panel_log if m[0] == 0 and 0x4C + 3 * n <= m[1] < 0x4F + 3 * n) for n in range(4)]
        now = menu_cases.leds(self.dev)
        return [now[3 * n:3 * n + 3] for n in range(4)], sent

    # ---- the pattern
    def live(self):
        return self.dev.read(self.dev.u32(edit.PATTERN_PTR) + 4, 0x4000)

    def saved(self, number=None):
        number = self.dev.u32(edit.RUNNING) if number is None else number
        return self.dev.read(self.dev.a(edit.BANK) + number * 0x4000, 0x4000)

    def screen(self):
        return self.dev.screen()["number"]

    def step_edit(self):
        """SEQUENCER, then pad 4: the step of the selected part goes on or off, as a finger does it."""
        edit.tap_key(self.dev, SEQUENCER, 0.3)
        edit.pad(self.dev, 3)
        self.dev.run(0.5)


def light_cases(w):
    out = []
    dev = w.dev
    written = dev.m.mmc.card.sectors_written
    menu_cases.watch_pins(dev)
    stock, kept = w.light(), w.settings()
    stock_duty = menu_cases.duty(dev, 0.2)[0]
    w.call("level", 15, 0, 4)
    mixed, mixed_duty = w.light(), menu_cases.duty(dev, 0.4)[0]
    clears = bytes.fromhex(mixed[2])
    out.append(entry("backlight_level_sets_the_pwm", mixed[0] == 0x28 and mixed[1] == 1 and clears[4] == 0x20 and not any(clears[:4] + clears[5:])
                     and mixed_duty["R"] > 0.97 and mixed_duty["G"] == 0 and abs(mixed_duty["B"] - 4 / 16) < 0.03,
                     f"15, 0, 4: pins {mixed[0]:#x}, PWM {mixed[1]}, cleared at tick {[i for i, v in enumerate(clears) if v]}, "
                     f"pins on for {mixed_duty} (the settings' light {stock_duty})"))
    out.append(entry("backlight_level_leaves_the_settings", w.settings() == kept and dev.m.mmc.card.sectors_written == written,
                     f"colour of the settings and the light of power save unchanged {w.settings() == kept}, "
                     f"sectors written to the card {dev.m.mmc.card.sectors_written - written}"))
    dev.call(w.built.symbols["menu_look_apply"])
    dev.run(0.1)
    out.append(entry("backlight_level_stays_over_a_menu_change", w.light() == mixed and w.settings() == kept,
                     f"after the menu worked its look out again: {w.light()}"))
    w.call("level", 0, 0, 0)
    dark, dark_duty = w.light(), menu_cases.duty(dev, 0.2)[0]
    out.append(entry("backlight_level_zero_is_dark", dark[0] == 0 and dark[1] == 0 and not any(dark_duty.values()), f"pins {dark[0]:#x}, on for {dark_duty}"))
    w.call("level", 3, 3, 3)
    w.call("lightBack")
    back_duty = menu_cases.duty(dev, 0.2)[0]
    out.append(entry("backlight_release_restores", w.light() == stock and back_duty == stock_duty and dev.u32(LOOK) == 0xFFFFFFFF and w.settings() == kept,
                     f"tables as before {w.light() == stock}, pins on for {back_duty}"))
    w.call("level", 9, 2, 0)
    set_again = w.light()
    w.call("fault", wait=0.3)
    out.append(entry("stopped_plugin_gives_the_light_back", set_again != stock and w.state() == 3 and w.light() == stock and dev.u32(LOOK) == 0xFFFFFFFF
                     and not dev.m.asserts, f"plugin state {w.state()}, tables as before {w.light() == stock}"))
    return out


def led_cases(w):
    out = []
    dev = w.dev
    colour = [10, 200, 30]
    menu_cases.meter_level(dev, 254)
    loud, _ = w.leds()
    w.call("led", 1, *colour)
    held, sent = w.leds(0.4)
    out.append(entry("bottom_led_stays_over_the_meter", held[1] == colour and held[0] == held[2] == held[3] and held[0][0] > 200 and held[0][1:] == loud[0][1:] and sent[1] == 0 and min(sent[0], sent[2], sent[3]) > 0,
                     f"LED 2 {held[1]} through ten rounds of the meter with no message of the meter for it {sent}, the others the meter's {held[0]}"))
    menu_cases.meter_level(dev, 0)
    quiet, _ = w.leds()
    out.append(entry("bottom_led_leaves_the_others_to_the_meter", quiet[1] == colour and quiet[0] == quiet[2] == quiet[3] != loud[0],
                     f"meter still: LED 2 {quiet[1]}, the others {quiet[0]} (loud {loud[0]})"))
    w.call("led", 3, 0, 1, 255)
    one, _ = w.leds()
    out.append(entry("bottom_led_never_sends_one", one[3] == [0, 2, 255] and one[1] == colour, f"0, 1, 255 on LED 4: {one[3]}"))
    # the colour of the settings (BLECH > CUSTOMIZATION > LED: a fixed colour) goes through our own loop of the meter hook
    dev.m.uc.mem_write(STATE + LED_V, bytes([50, 60, 70]))
    dev.m.uc.mem_write(STATE + LED_EFF, struct.pack("<I", 2))
    fixed, _ = w.leds()
    dev.m.uc.mem_write(STATE + LED_EFF, struct.pack("<I", 0))
    out.append(entry("bottom_led_stays_over_the_settings_colour", fixed[0] == fixed[2] == [50, 60, 70] and fixed[1] == colour and fixed[3] == [0, 2, 255], f"{fixed}"))
    # korg.ledHold shuts the firmware's way: the colour comes back with the hold's end
    w.call("ledHold", 1)
    w.call("ledHold", 0)
    after_hold, _ = w.leds()
    out.append(entry("bottom_led_comes_back_after_led_hold", after_hold[1] == colour and after_hold[3] == [0, 2, 255], f"{after_hold}"))
    menu_cases.meter_level(dev, 254)
    w.call("ledsBack")
    back, sent = w.leds()
    out.append(entry("bottom_release_gives_the_meter_back", back[0] == back[1] == back[2] == back[3] and back[0][0] > 200 and back[0][1:] == loud[0][1:] and min(sent) > 0
                     and dev.read(LOOK + 12, 4) == bytes(4), f"all four the meter's {back[0]}, messages per LED {sent}"))
    w.call("led", 0, 1, 2, 3)
    set_again, _ = w.leds()
    w.call("fault", wait=0.3)
    gone, _ = w.leds()
    out.append(entry("stopped_plugin_gives_the_leds_back", set_again[0] == [2, 2, 3] and w.state() == 3 and gone[0] == gone[1] == gone[2] and gone[0][0] > 200 and not dev.m.asserts,
                     f"plugin state {w.state()}, LED 1 {set_again[0]} then {gone[0]}"))
    return out


def sample_cases(w):
    out = []
    dev = w.dev
    loaded = [i for i in SAMPLES if dev.u32(META + i * 0x45C + 4)]
    if loaded != list(SAMPLES):
        return [entry("samples_loaded", False, f"the firmware loaded {loaded} of {list(SAMPLES)} from the card")]
    got = {i: (w.call("frames", i), w.call("rate", i), w.call("tune", i)) for i in SAMPLES}
    want = {i: s[5] for i, s in SAMPLES.items()}
    close = all(g[0] == x[0] and abs(g[1] - x[1]) <= 2 and g[2] == x[2] for g, x in zip(got.values(), want.values()))
    exact = all(got[i][1] == want[i][1] for i in SAMPLES if SAMPLES[i][2] == want[i][1])
    out.append(entry("sample_calls_match_the_card", close and exact,
                     f"frames, rate, tune per index {got}, the card's {want}; the firmware's tables: " + str({i: dict(
                         pcm=dev.u32(META + i * 0x45C + 4), stereo=dev.read(META + i * 0x45C + 9, 1)[0], named=dev.u32(META + i * 0x45C + 16),
                         start=dev.u32(PLAY + i * 16) - dev.u32(META + i * 0x45C), end=dev.u32(PLAY + i * 16 + 8),
                         period=struct.unpack("<H", dev.read(PERIOD + i * 8, 2))[0]) for i in SAMPLES})))
    none = [w.call("frames", 17), w.call("frames", 0), w.call("frames", 600), w.call("frames", 998), w.call("rate", 600), w.call("tune", 600)]
    out.append(entry("no_frames_for_oscillators_and_empty_slots", none == [0, 0, 0, 0, 48000, 0] and w.state() == ARMED and not dev.m.asserts,
                     f"frames of 17, 0, 600 and 998, rate and tune of 600: {none}"))
    return out


def save_cases(w, fresh):
    out = []
    dev = w.dev
    number = dev.u32(edit.RUNNING)
    others = [w.saved(number + n) for n in (1, 2, 3)]
    clean = w.vars()["unsaved"]
    w.step_edit()
    edited = w.live() != w.saved()
    dirty = w.vars()["unsaved"]
    out.append(entry("unsaved_follows_a_step_edit", clean == 0 and edited and dirty == 1, f"before {clean}, after SEQUENCER and a pad {dirty} (pattern differs {edited})"))
    started = w.call("save", wait=SAVE_S)
    out.append(entry("quick_save_stores_the_pattern", started == 1 and w.live() == w.saved() and w.screen() == 1 and w.vars()["unsaved"] == 0
                     and [w.saved(number + n) for n in (1, 2, 3)] == others and dev.u32(edit.RUNNING) == number and not dev.m.asserts,
                     f"returned {started}, saved into its own place {w.live() == w.saved()}, screen {w.screen()}, unsaved {w.vars()['unsaved']}, "
                     f"the next three places untouched {[w.saved(number + n) for n in (1, 2, 3)] == others}"))

    # the main dial while the Write window is open moves the place the second WRITE saves into: the firmware's own way
    plain = fresh()
    plain.step_edit()
    edit.tap_key(plain.dev, WRITE, 0.3)
    opened = plain.screen()
    plain.dev.turn(2, 0.3)
    edit.tap_key(plain.dev, WRITE, SAVE_S)
    moved = plain.saved(number + 2) == plain.live() and plain.saved(number) != plain.live()
    # the same turn while korg.quickSave waits for the window never reaches it
    w.step_edit()
    w.post("save")
    for _ in range(200):
        if 1 <= dev.read(STATE + SC_SAVE, 1)[0] <= 25:
            break
        dev.run(0.002)
    waiting = dev.read(STATE + SC_SAVE, 1)[0]
    for _ in range(2):
        dev.m.send([0x01, 0x00, 0x00, 0x01, 0])
    dev.run(SAVE_S)
    out.append(entry("quick_save_keeps_its_place_under_the_dial", opened == WINDOW and moved and 1 <= waiting <= 25 and w.vars()["out"] == 1
                     and w.live() == w.saved() and [w.saved(number + n) for n in (1, 2, 3)] == others and w.screen() == 1
                     and dev.u32(edit.RUNNING) == number and not dev.m.asserts,
                     f"WRITE, dial +2, WRITE by hand saves two places on {moved}; korg.quickSave with the dial turned while it waits ({waiting} frames left): "
                     f"own place {w.live() == w.saved()}, the next three untouched {[w.saved(number + n) for n in (1, 2, 3)] == others}, screen {w.screen()}"))

    # wrong states: nothing starts, nothing changes
    w.step_edit()
    before = (w.live(), w.saved(), others)

    def refused(name, enter, leave, expect):
        enter()
        at, got = expect(), w.call("save", wait=0.6)
        same = expect() == at and (w.live(), w.saved(), [w.saved(number + n) for n in (1, 2, 3)]) == before
        leave()
        return entry(f"quick_save_not_{name}", got == 0 and same and not dev.m.asserts, f"returned {got}, {name}: state kept {same} ({at})")

    out.append(refused("in_a_menu", lambda: edit.tap_key(dev, MENU, 0.4), lambda: edit.tap_key(dev, EXIT, 0.4), w.screen))
    out.append(refused("in_the_write_window", lambda: edit.tap_key(dev, WRITE, 0.4), lambda: edit.tap_key(dev, EXIT, 0.4), w.screen))
    out.append(refused("while_rec", lambda: edit.tap_key(dev, REC, 0.4), lambda: edit.tap_key(dev, STOP, 0.4), lambda: dev.u32(edit.TRANSPORT)))
    still = w.call("save", wait=SAVE_S)
    out.append(entry("quick_save_again_on_the_main_screen", still == 1 and w.live() == w.saved() and w.screen() == 1 and not dev.m.asserts,
                     f"back on the main screen it returned {still}, saved {w.live() == w.saved()}"))
    return out


def cases(vsb, flash=None):
    payload = vsb[0x100:]
    menu_cases.for_build(payload)
    build = identify(payload).build
    request = edit.compiled({"api26": PROGRAM})
    built = script_hooks.build(request["include"], build=build)
    programs = request["programs"]

    def world(files=None, seconds=2.0):
        w = World(vsb, flash, built, programs, files, seconds)
        w.built = built
        return w

    out = light_cases(world())
    out += save_cases(world(), world)
    if build != "synth":            # the synth has no samples, and its bottom LEDs are not measured: the calls do nothing there
        out += led_cases(world())
        out += sample_cases(world({"/KORG/blechtribe/Sample/e2sSample.all": bank()}, seconds=6.0))
    return out


def main():
    import lifetime
    lifetime.load_gate()
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--vsb", required=True, type=Path)
    p.add_argument("--flash", type=Path)
    a = p.parse_args()
    result = cases(a.vsb.read_bytes(), load_flash(a.flash) if a.flash else None)
    print(json.dumps(result, indent=1))
    sys.exit(0 if all(e["ok"] for e in result) else 1)


if __name__ == "__main__":
    main()
