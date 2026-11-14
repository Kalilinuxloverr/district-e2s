# SPDX-License-Identifier: GPL-2.0-only
"""Emulator cases of the patch audio-in (tools/patch/audio_in.py): AUDIO IN PAD, PANIC and the Audio In buffer.

A card with an own e2sSample.all (sampleset.py: part 16 plays slot 502, the others slot 501) and a plugin that puts the pages
AUDIO IN PAD, AUDIO IN PEGEL, AUDIO IN PUFFER and PANIC into FEATURES, as plugins/api26/AudioIn.js of the DISTRICT tree does
(or the three pages of 0.3.1, without AUDIO IN PEGEL). What the ARM hands the
sound engine and the DSP is read off the firmware's calls (note on and off, the part's program, the voice setup) and the host
port (mfx_cases.DspLog); the DSP is a stub, nothing is heard. The cases check that the pattern in RAM and the firmware's
unsaved compare stay as they were while Audio In is latched, and what the native sampling leaves on the card.

    tools/emu/.venv/bin/python tools/emu/audio_in_cases.py --vsb PATCHED.VSB [--flash FLASH.BIN] [--group N]
"""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", "") or Path(__file__).resolve().parents[2])
sys.path.insert(0, str(ROOT / "tools" / "patch"))
sys.path.insert(0, str(Path(__file__).parent))

import unicorn  # noqa: E402

import audio_in as spec  # noqa: E402
import node_json  # noqa: E402
import script_cases  # noqa: E402
import swap_cases as c  # noqa: E402
from machine import load_flash  # noqa: E402
from mfx_cases import DspLog  # noqa: E402

IMAGE = 0xC0000000
F = spec.FIRMWARE
MAILBOX = 0xFF900A34
PROGRAM = 0xC0094F8C            # (part, import number): the part's oscillator program to the DSP
VOICE_SETUP = 0xC0099A40        # r0 the voice: +0x40 its import number (45 Audio In), +0x14 its DSP voice
DSP_RECORD = 0xC0013D98         # (on, mono/stereo, source, DSP address): the host command 0x3B that starts and stops a recording
PART = 0xC009AF20               # (part) -> the part in the sound engine
SET_NUMBER, PSEL_PTR = 0xC0081F50, 0xC03487E8
MENU_STATE = 0xC01D6E00
SC_DIRTY = MENU_STATE - 1       # script_shortcuts.s: 1 while the pattern in RAM differs from its place in the bank
LAST_ERROR = 0xC00F9CC8         # the code the firmware's error window shows (preview_cases.py)
KEYS = {"rec": 0x00, "stop": 0x01, "play": 0x02, "menu": 0x09, "exit": 0x0D, "trigger": 0x13, "sequencer": 0x15,
        "keyboard": 0x17}
OWN, PART16 = 500, 501          # slots (zero based): what the parts play, what part 16 plays
AUDIO_IN_MN, AUDIO_IN_ST = 16, 17   # oscillators 017 and 018
PAGES = """let pad = korg.menu.add("AUDIO IN PAD", 0, {top}, {pad});
let buf = korg.menu.add("AUDIO IN PUFFER", 0, 30, {buf});
let panic = korg.menu.add("PANIC", 0, 1, {panic});
korg.menu.group(pad, "FEATURES");
korg.menu.group(buf, "FEATURES");
korg.menu.group(panic, "FEATURES");"""
LEVEL = """
let level = korg.menu.add("AUDIO IN PEGEL", 0, 127, {level});
korg.menu.group(level, "FEATURES");"""


def pages(pad, buf, level=127):
    """The pages of 0.3.2: AUDIO IN PAD 0 off, 1 mono, 2 stereo; AUDIO IN PEGEL; level None: those of 0.3.1 (on/off, no level)."""
    if level is None:
        return PAGES.format(top=1, pad=pad, buf=buf, panic=pad and 1)
    return PAGES.format(top=2, pad=pad, buf=buf, panic=pad and 1) + LEVEL.format(level=level)


SOURCES = {"on": pages(1, 2), "off": pages(0, 0), "old": pages(1, 2, None), "stereo": pages(2, 2, 64),
           # a plugin that keeps REC from the firmware, as Spielen's PARTY LOCK does (korg.keyMask)
           "locked": pages(1, 2) + "\nkorg.onEvent(\"ready\", () => { korg.keyMask(1 << korg.key.REC, 0); });"}


def node_requests():
    """Every answer this module asks Node for (node_json.py); tools/emu/node_results.py keeps them in its file."""
    node_json.compiled(SOURCES, probed=True)


def has_hooks(payload):
    """True when the part's sound setup calls the patch's code."""
    word = struct.unpack_from("<I", payload, spec.KIND_SITE - IMAGE)[0]
    if word >> 24 != 0xEB:
        return False
    off = (word & 0xFFFFFF) | (0xFF000000 if word & 0x800000 else 0)
    return spec.CODE_AT <= (spec.KIND_SITE + 8 + (off << 2)) & 0xFFFFFFFF < spec.CODE_END


def entry(name, ok, detail):
    return {"id": f"audio-in:{name}", "ok": bool(ok), "detail": str(detail)}


class Box:
    """A booted copy with our samples and, with `plugin`, the page plugin running. Notes the firmware's calls that matter."""

    def __init__(self, payload, flash, plugin="on", held=0, cap=None):
        extra = {}
        if plugin:
            blob = bytes.fromhex(node_json.compiled({plugin: SOURCES[plugin]}, probed=True)["programs"][plugin]["blob"])
            extra[script_cases.CARD_FILE] = script_cases.archive([blob]).hex()
        live = [OWN] * 15 + [PART16]
        self.box = c.Box(payload, flash, c.small([OWN, PART16]), live, held=held, record_dsp=True, extra=extra, cap=cap)
        self.m, self.uc, self.dev = self.box.m, self.box.m.uc, self.box.dev
        self.m.dsp_mem.update(self.box.dsp)
        self.calls = []
        regs = [getattr(unicorn.arm_const, f"UC_ARM_REG_R{i}") for i in range(4)]

        def note(kind):
            def hook(uc, *_):
                args = [uc.reg_read(r) for r in regs]
                if kind == "voice":
                    v = args[0]
                    args = [struct.unpack("<H", bytes(uc.mem_read(v + 0x40, 2)))[0], uc.mem_read(v + 0x14, 1)[0],
                            struct.unpack("<I", bytes(uc.mem_read(v + 4, 4)))[0]]
                self.calls.append((kind, *args))
            return hook
        for kind, at in (("on", F["NOTE_ON"]), ("off", F["NOTE_OFF"]), ("program", PROGRAM), ("voice", VOICE_SETUP),
                         ("notes_off", F["NOTES_OFF"]), ("record", DSP_RECORD), ("open", F["OPEN"])):
            self.uc.hook_add(unicorn.UC_HOOK_CODE, note(kind), begin=at, end=at)
        self.uc.ctl_flush_tb()
        self.run(1.5)                           # the plugin runtime loads the card's plugins
        self.log = DspLog(self.m)
        self.part15 = self.dev.call(PART, 15)

    def run(self, seconds):
        self.box.run(seconds)

    def u32(self, addr):
        return self.box.u32(addr)

    def u8(self, addr):
        return self.uc.mem_read(addr, 1)[0]

    def clear(self):
        self.calls.clear()
        self.log.clear()

    def got(self, kind):
        return [x[1:] for x in self.calls if x[0] == kind]

    def mailbox(self):
        return [tuple(x[3]) for x in self.log.xfers if x[0] == 0xAB and x[1] == MAILBOX and x[3] and x[3][0] & 2]

    def releases(self, voice):
        """The 0x26 messages that release DSP voice `voice` (its parameters from 0x43AB + 26 per voice)."""
        if voice is None:
            return []
        return [m for m in self.mailbox() if len(m) > 3 and m[1] == 0x26 and m[3] == 0x43AB + 26 * voice]

    def pad(self, n, wait=0.4):
        self.m.send([0x04, n, 0, 100, 1])
        self.run(0.1)
        self.m.send([0x04, n, 0, 0, 0])
        self.run(wait)

    def key(self, name, wait=0.4):
        self.m.press(KEYS[name], True)
        self.run(0.1)
        self.m.press(KEYS[name], False)
        self.run(wait)

    def exit_and(self, name, wait=0.4):
        """EXIT held, the key tapped, EXIT let go."""
        self.m.press(KEYS["exit"], True)
        self.run(0.15)
        self.key(name, 0.1)
        self.m.press(KEYS["exit"], False)
        self.run(wait)

    def state(self, offset):
        return self.u32(spec.ST + offset)

    def pattern(self):
        return hashlib.sha256(bytes(self.uc.mem_read(self.u32(c.PATPTR) + 4, 0x4000))).hexdigest()

    def dirty(self):
        return self.u8(SC_DIRTY)

    def ledmgr(self):
        return self.u32(F["LEDMGR"])

    def pad16_led(self):
        return self.u8(self.ledmgr() + 0x4E + 8 * spec.PAD16_RED)

    def mode(self):
        return self.u32(self.ledmgr() + 0xB58)

    def transport(self):
        return self.u32(0xC06BC318)

    def manager(self):
        return self.dev.call(F["MANAGER"])

    def import_of(self, slot):
        return struct.unpack("<H", bytes(self.uc.mem_read(c.NAMES + slot * 32 + 30, 2)))[0]

    def part_sample(self, part):
        return struct.unpack("<H", bytes(self.uc.mem_read(self.u32(c.PATPTR) + 4 + 0x800 + 0x330 * part + 8, 2)))[0]

    def page_at(self, name):
        """Where the runtime keeps the value of a live plugin page of that name in FEATURES, None without one."""
        n = self.u32(MENU_STATE + 60)
        for i in range(min(n, 64)):
            at = 0xC018D040 + 40 * i
            if bytes(self.uc.mem_read(at + 20, 16)).split(b"\0")[0] == name.encode() and self.u8(at + 16) == 1:
                return at + 12
        return None

    def page(self, name):
        """The value of a live plugin page of that name in FEATURES, as the runtime finds it, -1 without one."""
        at = self.page_at(name)
        return -1 if at is None else struct.unpack("<i", bytes(self.uc.mem_read(at, 4)))[0]

    def set_page(self, name, value):
        """The page turned to `value`: the word the dial of the BLECH menu ends in, the one the patch reads."""
        self.uc.mem_write(self.page_at(name), struct.pack("<i", value))


def latched_voice(b):
    """The DSP voice of the note the patch plays (the voice setup of part 16 with Audio In), None without one."""
    for imp, voice, part in b.got("voice"):
        if part == b.part15 and imp == 45:
            return voice
    return None


def case_latch(payload, flash):
    b = Box(payload, flash)
    out = [entry("pages_found", b.page(spec.PAGE_PAD) == 1 and b.page(spec.PAGE_LEVEL) == 127 and b.page(spec.PAGE_BUF) == 2
                 and b.mode() == spec.TRIGGER, f"AUDIO IN PAD {b.page(spec.PAGE_PAD)}, AUDIO IN PEGEL {b.page(spec.PAGE_LEVEL)}, "
                 f"AUDIO IN PUFFER {b.page(spec.PAGE_BUF)}, pad mode {b.mode()}")]
    before, dirty = b.pattern(), b.dirty()
    b.clear()
    b.pad(15)
    voice = latched_voice(b)
    ons = b.got("on")
    out.append(entry("tap_latches_audio_in_on_part_16", ons == [(15, spec.AI_SRC, spec.AI_NOTE, spec.AI_VEL)] and voice is not None
                     and (15, 45) in [x[:2] for x in b.got("program")] and b.state(spec.O_LATCH) == 1,
                     f"notes on {ons}, voice {voice}, programs {b.got('program')}, latch {b.state(spec.O_LATCH)}"))
    out.append(entry("pad_16_lights", b.pad16_led() == spec.LED_ON, f"pad 16 red {b.pad16_led():#x}"))
    b.run(1.0)
    out.append(entry("pattern_and_unsaved_unchanged_while_latched", b.pattern() == before and b.dirty() == dirty == 0,
                     f"pattern same {b.pattern() == before}, unsaved {dirty} -> {b.dirty()}"))
    b.clear()
    for name in ("sequencer", "keyboard", "trigger", "menu", "exit"):
        b.key(name, 0.4)
    b.key("play", 1.5)
    b.key("stop", 0.6)
    ours = [x for x in b.got("off") if x[:2] == (15, spec.AI_SRC)]
    out.append(entry("survives_modes_menu_and_sequencer", not ours and not b.releases(voice) and b.state(spec.O_LATCH) == 1
                     and b.mode() == spec.TRIGGER and b.pad16_led() == spec.LED_ON,
                     f"note-offs {ours}, releases of voice {voice}: {b.releases(voice)}, latch {b.state(spec.O_LATCH)}"))
    b.clear()
    b.pad(15)
    own = b.import_of(PART16)
    out.append(entry("second_tap_unlatches", b.got("off")[:1] == [(15, spec.AI_SRC, spec.AI_NOTE, 0)]
                     and (15, own) in [x[:2] for x in b.got("program")] and b.state(spec.O_LATCH) == 0 and b.pad16_led() == 0
                     and not [x for x in b.got("on") if x[0] == 15],
                     f"note-offs {b.got('off')}, programs {b.got('program')}, latch {b.state(spec.O_LATCH)}, pad 16 {b.pad16_led():#x}"))
    b.run(0.5)
    out.append(entry("pattern_and_unsaved_unchanged_after", b.pattern() == before and b.dirty() == 0, f"unsaved {b.dirty()}"))
    b.clear()
    b.dev.call(F["NOTE_ON"], 15, 0x40, 60, 100)
    b.run(0.2)
    imports = [x[0] for x in b.got("voice") if x[2] == b.part15]
    b.dev.call(F["NOTE_OFF"], 15, 0x40, 60, 0)
    b.run(0.2)
    out.append(entry("part_16_own_sound_back", imports == [own], f"voice import numbers {imports}, part 16's sample {own}"))
    out.append(entry("latch_no_assertion", not b.m.asserts, b.m.asserts))
    return out


def case_ends(payload, flash):
    b = Box(payload, flash)
    out = []
    b.pad(15)
    b.clear()
    b.dev.call(SET_NUMBER, b.u32(PSEL_PTR), 1, 1)
    b.run(0.8)
    out.append(entry("pattern_change_ends_it", (15, spec.AI_SRC, spec.AI_NOTE, 0) in b.got("off") and b.state(spec.O_LATCH) == 0,
                     f"note-offs {b.got('off')}, latch {b.state(spec.O_LATCH)}"))
    b.pad(15)
    voice = latched_voice(b)
    b.dev.call(F["NOTE_ON"], 2, 0x40, 64, 100)
    b.run(0.2)
    other = [v for imp, v, part in b.got("voice") if part == b.dev.call(PART, 2)]
    b.key("play", 0.8)
    b.clear()
    b.exit_and("stop", 0.5)
    parts = sorted(set(x[0] for x in b.got("notes_off")))
    out.append(entry("exit_stop_panics", parts == list(range(16)) and (15, spec.AI_SRC, spec.AI_NOTE, 0) in b.got("off")
                     and b.state(spec.O_LATCH) == 0 and other and b.releases(other[-1]),
                     f"All Notes Off for parts {parts}, note-offs {b.got('off')}, latch {b.state(spec.O_LATCH)}, "
                     f"releases of part 3's voice {other}: {b.releases(other[-1]) if other else None}"))
    out.append(entry("stop_still_stops", b.transport() == 0, f"transport {b.transport()}"))
    out.append(entry("ends_no_assertion", not b.m.asserts and voice is not None, b.m.asserts))
    return out


def stock_behaviour(b, name):
    """Pad 16 plays part 16 as the firmware does, EXIT + STOP and EXIT + REC do none of the patch's work."""
    b.clear()
    b.pad(15)
    ons = b.got("on")
    b.exit_and("stop", 0.3)
    panic = b.got("notes_off")
    b.clear()
    b.exit_and("rec", 0.5)
    sampling = 42 in [x[0] for x in b.got("open")] or b.transport() in (10, 11)
    return entry(f"{name}_as_the_firmware", [x[:3] for x in ons[:1]] == [(15, 0x40, 60)] and not panic and not sampling
                 and b.state(spec.O_LATCH) != 1 and not b.m.asserts,
                 f"notes on {ons}, All Notes Off {panic}, sampling {sampling}, transport {b.transport()}")


def case_off(payload, flash):
    out = [stock_behaviour(Box(payload, flash, plugin="off"), "pages_off"),
           stock_behaviour(Box(payload, flash, plugin=None), "no_plugin"),
           stock_behaviour(Box(payload, flash, plugin="on", held=spec.KILL), "exit_at_power_on")]
    return out


def case_buffer(payload, flash):
    b = Box(payload, flash)
    manager = b.manager()
    b.uc.mem_write(manager + 0x704, struct.pack("<H", 1))      # the window was on stereo resampling
    b.uc.mem_write(manager + 0x708, struct.pack("<H", 1))
    b.pad(2)                                                    # part 3 selected
    part = b.u32(b.ledmgr() + 0xB60)
    cursor = b.u32(c.CURSOR)
    slot = b.dev.call(0xC004EF94)
    b.clear()
    b.exit_and("rec", 0.3)
    started = b.got("record")[:1]
    recording = b.transport()
    pcm = b"".join(struct.pack("<h", (i * 37) % 20000 - 10000) for i in range(3000))
    for at in range(0, len(pcm), 2):
        b.m.dsp_mem[cursor + at] = struct.unpack_from("<H", pcm, at)[0]
    end = cursor + len(pcm)
    b.m.dsp_mem[0xFF903210] = end & 0xFFFF
    b.m.dsp_mem[0xFF903212] = end >> 16
    out = [entry("exit_rec_samples_audio_in_mono", started == [(1, 0, 0, cursor)] and recording == spec.STATE_RECORDING,
                 f"DSP record {started} (on, mono 0, Audio In 0, from {cursor:#x}), transport {recording}")]
    b.run(0.8)
    vram = bytes(b.uc.mem_read(F["VRAM"] + spec.BAR_PAGE * 128, 128))
    filled = sum(1 for x in range(spec.BAR_X0 + 1, spec.BAR_X1 - 1) if vram[x] & 0x0C == 0x0C)
    out.append(entry("bar_fills_while_recording", 15 <= filled <= 70, f"{filled} of {spec.BAR_X1 - spec.BAR_X0 - 2} columns filled after about 1 s of 2 s"))
    b.run(3.0)
    library = c.fat32.Volume(bytes(b.m.mmc.card.medium.data))
    try:
        data = library.read(f"KORG/{c.cardstore.card_folder(b.box.payload)}/Sample/e2sSample.all")
    finally:
        library.close()
    offset = struct.unpack_from("<I", data, 16 + slot * 4)[0]
    kept = offset != 0 and pcm in data[offset:]
    out.append(entry("after_the_time_kept_and_on_the_part", b.transport() == 0 and b.box.resident(slot) and kept
                     and b.part_sample(part) == slot and b.state(spec.O_PHASE) == 0,
                     f"transport {b.transport()}, slot {slot} loaded {b.box.resident(slot)}, on the card {kept}, "
                     f"part {part + 1} plays {b.part_sample(part)}"))
    out.append(entry("window_settings_back", (struct.unpack("<H", bytes(b.uc.mem_read(manager + 0x708, 2)))[0],
                                               struct.unpack("<H", bytes(b.uc.mem_read(manager + 0x704, 2)))[0]) == (1, 1),
                     "source and stereo as before EXIT + REC"))
    out.append(entry("buffer_no_assertion", not b.m.asserts, b.m.asserts))
    return out


def case_refusals(payload, flash):
    out = []
    swap = Box(payload, flash, cap=4096)
    library = lambda box: hashlib.sha256(bytes(box.m.mmc.card.medium.data)).hexdigest()
    before = library(swap)
    swap.clear()
    swap.exit_and("rec", 1.0)
    out.append(entry("refused_while_the_swap_is_on", swap.box.state("MODE") == 1 and not swap.got("record") and swap.transport() == 0
                     and library(swap) == before, f"swap mode {swap.box.state('MODE')}, records {swap.got('record')}, transport {swap.transport()}"))
    b = Box(payload, flash)
    b.key("play", 0.5)
    playing = b.transport()
    b.clear()
    b.exit_and("rec", 1.0)
    out.append(entry("refused_while_playing", playing != 0 and not b.got("record") and not b.got("open"), f"transport {playing}, records {b.got('record')}"))
    b.key("stop", 0.5)
    b.uc.mem_write(c.CURSOR, struct.pack("<I", 0x1C65EC0 - 50000))     # less than a second free
    b.clear()
    b.exit_and("rec", 0.6)
    out.append(entry("memory_full_window", not b.got("record") and b.u32(LAST_ERROR) == spec.ERR_FULL,
                     f"records {b.got('record')}, error code {b.u32(LAST_ERROR)}"))
    lock = Box(payload, flash, plugin="locked")
    lock.clear()
    lock.exit_and("rec", 1.0)
    out.append(entry("a_key_a_plugin_holds_stays_the_plugins", not lock.got("record") and not lock.got("open") and lock.transport() == 0,
                     f"records {lock.got('record')}, transport {lock.transport()}"))
    out.append(entry("refusals_no_assertion", not b.m.asserts and not swap.m.asserts and not lock.m.asserts, (b.m.asserts, swap.m.asserts)))
    return out


def input_word(b, voice):
    """The word the ARM keeps sending to +3 of a voice's parameters (message 0x2D): for an Audio In voice its input level, from
    OSC EDIT (0 with OSC EDIT at its lowest, docs/messungen/2026-11-13-audio-in.md)."""
    if voice is None:
        return None
    words = [m[3] for m in b.mailbox() if len(m) > 3 and m[1] == 0x2D and m[2] == 0x43AB + 26 * voice + 3]
    return words[-1] if words else None


def voice_links(b):
    """The voices a note start links to part 16's parameters (message 0x09 with the part's block, 24 + 26 * 15)."""
    return [m[3] for m in b.mailbox() if len(m) > 3 and m[1] == 0x09 and m[2] == 24 + 26 * 15]


def case_korg_parity(payload, flash):
    """The latched voice gets what Korg's own Audio In voice gets: part 16 on oscillator 017 through the SAMPLE encoder (which
    also sets OSC EDIT to the oscillator's default), pad 16 held, against our latch on a part whose sample left OSC EDIT at 0,
    with the pages of 0.3.1 (no AUDIO IN PEGEL: the oscillator's default). Latching again after an unlatch starts the voice again."""
    k = Box(payload, flash, plugin="off")
    k.pad(15)                                                   # part 16 selected, as the user's first tap would
    rec = k.u32(c.PATPTR) + 4 + 0x800 + 0x330 * 15
    k.uc.mem_write(rec + 8, struct.pack("<H", AUDIO_IN_MN - 1))
    k.m.send([0x01, 0x01, 0x00, 0x01, 0])                       # the SAMPLE encoder one up: 017 Audio In Mn
    k.run(0.6)
    k.clear()
    k.m.send([0x04, 15, 0, 100, 1])
    k.run(0.4)
    korg = input_word(k, latched_voice(k))
    b = Box(payload, flash, plugin="old")
    own_osc_edit = b.u8(b.u32(c.PATPTR) + 4 + 0x800 + 0x330 * 15 + 11)
    b.clear()
    b.pad(15)
    ours = input_word(b, latched_voice(b))
    out = [entry("input_level_as_korgs_audio_in", korg not in (None, 0) and ours == korg and k.part_sample(15) == AUDIO_IN_MN,
                 f"Korg's voice {korg if korg is None else hex(korg)}, ours {ours if ours is None else hex(ours)} "
                 f"(part 16's OSC EDIT {own_osc_edit}, Korg's change set it to {k.u8(rec + 11)})")]
    links = []
    for _ in range(3):
        b.clear()
        b.pad(15)                                               # unlatch
        b.clear()
        b.pad(15)                                               # latch again
        links.append((voice_links(b), input_word(b, latched_voice(b)), b.state(spec.O_LATCH)))
    out.append(entry("latching_again_starts_the_voice", all(v and w == korg and latch == 1 for v, w, latch in links),
                     f"per latch: voices linked to part 16, input word, latch: {links}"))
    b.clear()
    b.pad(15)
    own = b.import_of(PART16)
    out.append(entry("unlatched_again_part_16_plays_its_sample", (15, own) in [x[:2] for x in b.got("program")] and b.state(spec.O_LATCH) == 0,
                     f"programs {b.got('program')}"))
    out.append(entry("parity_no_assertion", not b.m.asserts and not k.m.asserts, (b.m.asserts, k.m.asserts)))
    return out


def korg_voice(payload, flash, osc, knobs=()):
    """Korg's own Audio In: part 16 on oscillator `osc` (zero based) through the SAMPLE encoder, pad 16 held, then the OSC EDIT
    knob turned to each of `knobs` (raw 0 to 255). -> the box, the voice, its start messages, the input word after the hold
    and after each knob with the part's OSC EDIT."""
    k = Box(payload, flash, plugin="off")
    k.pad(15)                                                   # part 16 selected, as the user's first tap would
    rec = k.u32(c.PATPTR) + 4 + 0x800 + 0x330 * 15
    k.uc.mem_write(rec + 8, struct.pack("<H", osc - 1))
    k.m.send([0x01, 0x01, 0x00, 0x01, 0])                       # the SAMPLE encoder one up
    k.run(0.6)
    k.clear()
    k.m.send([0x04, 15, 0, 100, 1])
    k.run(0.4)
    voice = latched_voice(k)
    first = starts(k, voice)
    words = [(k.u8(rec + 11), input_word(k, voice))]
    for raw in knobs:
        k.clear()
        k.m.send([0x02, 9, 0, raw, 0])                          # the OSC EDIT knob
        k.run(0.4)
        words.append((k.u8(rec + 11), input_word(k, voice)))
    return k, voice, first, words


def starts(b, voice):
    """What a note start sends about its voice and part (link, type, routing), the voice's addresses taken from its own base, so
    two voices compare; without the level words (0x2D) and the note's velocity (0x02)."""
    if voice is None:
        return None
    base = 0x43AB + 26 * voice
    rel = lambda x: f"v+{x - base}" if base <= x < base + 26 else x  # noqa: E731
    return [(m[1], rel(m[2]), rel(m[3])) for m in b.mailbox() if len(m) > 3 and m[1] in (0x09, 0x2E, 0x32, 0x33, 0x34, 0x35, 0x1F)]


def part_fields(b):
    """Part 16 in the sound engine: its oscillator (+0x34), stereo mode (+0x39), the sound its voices start with (+0x28)."""
    return (struct.unpack("<H", bytes(b.uc.mem_read(b.part15 + 0x34, 2)))[0], b.u8(b.part15 + 0x39), hex(b.u32(b.part15 + 0x28)))


def case_level(payload, flash):
    """AUDIO IN PEGEL is the latched voice's OSC EDIT: the input word Korg's own Audio In voice gets with OSC EDIT at that value
    (the knob turned while pad 16 is held). Turned while latched, the voice gets the new word at once, as from Korg's knob:
    no note-off, no new voice, the same voice."""
    _, _, _, korg = korg_voice(payload, flash, AUDIO_IN_MN, knobs=(128, 254, 60, 4, 0))   # the knob catches OSC EDIT at 64 first
    word = dict(korg)                                           # OSC EDIT -> Korg's input word
    b = Box(payload, flash)
    b.clear()
    b.pad(15)
    voice = latched_voice(b)
    full = input_word(b, voice)
    out = [entry("level_127_as_korgs_osc_edit_127", 127 in word and full == word[127] and full > word.get(64, 0),
                 f"ours {full if full is None else hex(full)} with AUDIO IN PEGEL 127; Korg's OSC EDIT to input word "
                 f"{ {e: hex(w) for e, w in korg if w is not None} }")]
    live = []
    for level in (64, 0, 127):
        b.clear()
        b.set_page(spec.PAGE_LEVEL, level)
        b.run(0.3)
        live.append((level, input_word(b, voice), b.got("on"), b.got("off"), [x for x in b.got("voice") if x[2] == b.part15],
                     b.releases(voice), b.state(spec.O_LATCH)))
    out.append(entry("level_turned_while_latched_goes_live", all(level in word and w == word[level] and not on and not off
                                                                 and not voices and not rel and latch == 1
                                                                 for level, w, on, off, voices, rel, latch in live),
                     f"per level: word, notes on, notes off, voice setups of part 16, releases, latch: "
                     f"{[(lv, w if w is None else hex(w), *rest) for lv, w, *rest in live]}"))
    b.pad(15)                                                   # unlatch
    b.set_page(spec.PAGE_LEVEL, 30)
    b.run(0.3)
    b.clear()
    b.pad(15)                                                   # latch again: the level of the page
    again = input_word(b, latched_voice(b))
    out.append(entry("next_latch_takes_the_page", 30 in word and again == word[30],
                     f"ours {again if again is None else hex(again)} with AUDIO IN PEGEL 30, Korg's {word.get(30)}"))
    out.append(entry("level_no_assertion", not b.m.asserts, b.m.asserts))
    return out


def case_stereo(payload, flash):
    """AUDIO IN PAD STEREO latches what Korg sets up when oscillator 018 (Audio In St) is picked by hand on part 16: the part
    reads 018, its stereo mode (+0x39) and the sound its voices start with (+0x28) as Korg leaves them, as many voices, the same
    start messages and the same input word (AUDIO IN PEGEL 64, Korg's default). As in Korg's way, part 16 has just played its
    sample, so the latch's note takes over that voice and has to give it Audio In. The second tap gives part 16 its sample back."""
    k, kv, korg, kw = korg_voice(payload, flash, AUDIO_IN_ST)
    kvoices = [x for x in k.got("voice") if x[2] == k.part15]
    kfield = part_fields(k)
    mono = korg_voice(payload, flash, AUDIO_IN_MN)[2]
    b = Box(payload, flash, plugin="stereo")
    b.dev.call(F["NOTE_ON"], 15, 0x40, 60, 100)                # part 16 plays its sample once, as in Korg's way the tap that selects
    b.run(0.1)                                                  # it does: the next note takes over that voice (0x26 first); a note on
    b.dev.call(F["NOTE_OFF"], 15, 0x40, 60, 0)                 # a free voice goes another way and sends the part's routing (0x34,
    b.run(0.4)                                                  # 0x35) as well
    b.clear()
    b.pad(15)
    voice = latched_voice(b)
    voices = [x for x in b.got("voice") if x[2] == b.part15]
    field = part_fields(b)
    ours, word = starts(b, voice), input_word(b, voice)
    out = [entry("stereo_as_korgs_018_on_part_16", b.page(spec.PAGE_PAD) == 2 and field == kfield and field[0] == AUDIO_IN_ST
                 and len(voices) == len(kvoices) == 1 and voices[0][0] == kvoices[0][0] == 45 and ours == korg and word == kw[0][1]
                 and (15, 45) in [x[:2] for x in b.got("program")] and b.state(spec.O_LATCH) == 1,
                 f"part 16 oscillator, stereo mode, sound of its voices: Korg {kfield}, ours {field}; voices Korg {kvoices}, ours {voices}; "
                 f"start messages Korg {korg}, ours {ours}; input word Korg {kw[0]}, ours {word}; "
                 f"Korg's 017 on part 16 starts the same: {mono == korg}")]
    b.clear()
    b.pad(15)
    own = b.import_of(PART16)
    out.append(entry("stereo_unlatched_part_16_plays_its_sample", (15, own) in [x[:2] for x in b.got("program")]
                     and b.state(spec.O_LATCH) == 0 and struct.unpack("<H", bytes(b.uc.mem_read(b.part15 + 0x34, 2)))[0] == PART16,
                     f"programs {b.got('program')}"))
    out.append(entry("stereo_no_assertion", not b.m.asserts and not k.m.asserts, (b.m.asserts, k.m.asserts)))
    return out


GROUPS = (case_latch, case_ends, case_off, case_buffer, case_refusals, case_korg_parity, case_level, case_stereo)


def group_entries(payload, flash, i):
    return GROUPS[i](payload, flash)


def cases_task(i):
    """group_entries in a worker (parallel.py)."""
    import parallel
    return group_entries(parallel.shared["payload"], parallel.shared["flash"], i)


def cases(payload, flash=None):
    return [e for i in range(len(GROUPS)) for e in group_entries(payload, flash, i)]


def main():
    import lifetime
    lifetime.load_gate()
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--vsb", required=True, type=Path)
    p.add_argument("--flash", type=Path)
    p.add_argument("--group", type=int, action="append")
    a = p.parse_args()
    payload = a.vsb.read_bytes()[0x100:]
    flash = load_flash(a.flash) if a.flash else None
    groups = a.group if a.group else range(len(GROUPS))
    result = [e for i in groups for e in group_entries(payload, flash, i)]
    print(json.dumps(result, indent=1, ensure_ascii=False))
    sys.exit(0 if all(e["ok"] for e in result) else 1)


if __name__ == "__main__":
    main()
