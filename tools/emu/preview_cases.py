# SPDX-License-Identifier: GPL-2.0-only
"""Emulator cases of the sample preview (tools/patch/sample_preview.py).

A card with an own e2sSample.all (sampleset.py) and own WAVs in its root. The cases open DATA UTILITY > IMPORT SAMPLE, put the
cursor on a WAV and press PLAY. What the ARM sends to the DSP is read off the host port (the DSP is a stub: no sound): the
audio written above the free pointer, and the messages of the voice the note starts (its DSP address and period). They check
that nothing else changes: card, flash, the sample tables, the free pointer and the pattern in RAM. PLAY again starts the
preview anew without reading the file again, as Korg retriggers a MONO part from its pad: the preview's voice is cut (0x26) and
starts again, the same voice every time, never two. Keys that pile up while a long file is read never sound the part's own
sample.

    tools/emu/.venv/bin/python tools/emu/preview_cases.py --vsb PATCHED.VSB [--flash FLASH.BIN]
"""

import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(getattr(sys, "_MEIPASS", "") or Path(__file__).resolve().parents[2])
sys.path.insert(0, str(ROOT / "tools" / "patch"))
sys.path.insert(0, str(Path(__file__).parent))

import unicorn  # noqa: E402

import sample_preview as spec  # noqa: E402
import swap_cases as c  # noqa: E402
from machine import load_flash  # noqa: E402
from mfx_cases import DspLog  # noqa: E402

IMAGE = 0xC0000000
MAILBOX = 0xFF900A34
NOTE_ON, NOTE_OFF, F_OPEN = (spec.FIRMWARE[k] for k in ("NOTE_ON", "NOTE_OFF", "F_OPEN"))
NOTES_OFF = 0xC00983FC                          # a part's All Notes Off (the path of MIDI CC 123), which 0.3.2 sent before each PLAY
VOICES = 0x43AB                                 # the DSP parameters of voice v start at 0x43AB + 26 * v
VA_SETTER, PARTS = 0xC00493A0, 0x400C           # Korg's VOICE ASSIGN setter (pattern object + PARTS, part, value, 1); 1 is Mono2
CURSOR, DSP_END = spec.FIRMWARE["CURSOR"], spec.FIRMWARE["DSP_END"]
BROWSER = 39                                    # the screen number of the IMPORT SAMPLE browser
ERROR_CLASS, LAST_ERROR = 0xC00E3318, 0xC00F9CC8   # the error window's class and the code it shows (0xC0063068)
TABLES = ((c.NAMES, 999 * 32), (0xC035738C, 999 * 32), (0xC035F06C, 999 * 16), (0xC0350644, 1000 * 8),
          (c.PLAYBACK, 1000 * 16), (c.META, 1000 * 0x45C))
KILL = 0x2000


def wav(rate, channels, bits, frames, seed=1):
    """A plain WAV (fmt and data only) with a formula in it."""
    data = bytearray()
    for i in range(frames):
        for ch in range(channels):
            v = int(12000 * math.sin((i + 7 * ch) * 0.013 * seed)) + 37 * ch
            data += (v & 0xFFFFFF).to_bytes(3, "little")[3 - bits // 8:]
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * channels * bits // 8, channels * bits // 8, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", 16) + fmt + b"data" + struct.pack("<I", len(data)) + bytes(data)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def mono16(raw, channels, bits):
    """The 16-bit mono audio the preview writes to the DSP: the upper 16 bits of 24, the mean of two channels."""
    data = raw[raw.index(b"data") + 8:]
    step = bits // 8
    out = bytearray()
    for at in range(0, len(data) - channels * step + 1, channels * step):
        vals = [struct.unpack("<h", data[at + k * step + step - 2:at + k * step + step])[0] for k in range(channels)]
        out += struct.pack("<h", sum(vals) >> 1 if channels == 2 else vals[0])
    return bytes(out)


FILES = {"/a.wav": wav(48000, 1, 16, 48000), "/b.wav": wav(44100, 2, 24, 2500, 3), "/c.wav": b"RIFF" + bytes(60),
         "/d.wav": wav(48000, 1, 16, 0), "/KORG/k.wav": wav(32000, 1, 24, 4000, 5),
         "/long.wav": wav(48000, 2, 24, 144000, 7)}   # 3 s, 864 KB: its read takes longer than a few taps
PERIOD = {"/a.wav": 0x3C00, "/b.wav": 0x3D78, "/KORG/k.wav": 0x4305}      # 63132 - log2(rate) * 3072, as the firmware's import computes it


def has_hooks(payload):
    """True when the browser's PLAY slot calls the preview's code."""
    slot = struct.unpack_from("<I", payload, spec.BROWSER_VT + 12 - IMAGE)[0]
    return spec.CODE_AT <= slot < spec.CODE_END


def entry(name, ok, detail):
    return {"id": f"preview:{name}", "ok": bool(ok), "detail": detail}


class Preview:
    def __init__(self, payload, flash, live=(500, 501), held=0):
        self.box = c.Box(payload, flash, c.small([500, 501]), list(live), held=held, record_dsp=True,
                         extra={path: data.hex() for path, data in FILES.items()})
        self.m, self.uc = self.box.m, self.box.m.uc
        self.notes = []
        regs = [getattr(unicorn.arm_const, f"UC_ARM_REG_R{i}") for i in range(4)]

        def note(kind):
            return lambda uc, *_: self.notes.append((kind, *(uc.reg_read(r) for r in regs), self.m.time_ns / 1e9))
        self.uc.hook_add(unicorn.UC_HOOK_CODE, note("on"), begin=NOTE_ON, end=NOTE_ON)
        self.uc.hook_add(unicorn.UC_HOOK_CODE, note("off"), begin=NOTE_OFF, end=NOTE_OFF)
        self.uc.hook_add(unicorn.UC_HOOK_CODE, note("cut"), begin=NOTES_OFF, end=NOTES_OFF)
        self.uc.hook_add(unicorn.UC_HOOK_CODE, note("open"), begin=F_OPEN, end=F_OPEN)
        self.uc.ctl_flush_tb()
        self.log = DspLog(self.m)

    def u32(self, addr):
        return self.box.u32(addr)

    def screen(self):
        mgr = self.u32(0xC03404C0)
        return self.u32(mgr + 0x2C), self.u32(mgr + 0x24)

    def browser(self, rights=None):
        """Into the IMPORT SAMPLE browser. With `rights` the page is found by count (the titles differ without BLECH)."""
        if rights is None:
            found = self.box.data_utility("import sample")
        else:
            self.box.dev.call(c.SWITCH_SCREEN, 14, 0)
            self.box.run(0.4)
            self.box.tap("menu")
            for _ in range(rights):
                self.box.tap("right", 0.25)
            found = True
        self.box.tap("menu", 1.0)
        return found and self.screen()[0] == BROWSER

    def names(self):
        mgr = self.u32(0xC03404C0)
        cur = self.u32(mgr + 0x20)
        folder, view = self.u32(cur + 0x20), self.u32(cur + 0x24)
        items = range(self.u32(folder + 0x308), self.u32(folder + 0x30C), 4)
        names = [bytes(self.uc.mem_read(self.u32(self.u32(at) + 8), 32)).split(b"\0")[0].decode() for at in items]
        return names, self.u32(view + 0x35C) + self.u32(view + 0x360)

    def cursor_to(self, name):
        for _ in range(8):
            names, at = self.names()
            if name in names and names.index(name) == at:
                return True
            if name not in names:
                return False
            self.box.dev.turn(names.index(name) - at, 0.4)
        return False

    def snapshot(self):
        h = hashlib.sha256()
        for at, n in TABLES:
            h.update(bytes(self.uc.mem_read(at, n)))
        pattern = bytes(self.uc.mem_read(self.u32(c.PATPTR) + 4, 0x4000))
        card = hashlib.sha256(bytes(self.m.mmc.card.medium.data)).hexdigest()
        flash = hashlib.sha256(bytes(self.m.flash.mem)).hexdigest()
        return dict(tables=h.hexdigest(), cursor=self.u32(CURSOR), pattern=hashlib.sha256(pattern).hexdigest(), card=card, flash=flash)

    def base(self):
        return (self.u32(CURSOR) + 31) & ~31

    def mailbox(self):
        return [tuple(x[3]) for x in self.log.xfers if x[0] == 0xAB and x[1] == MAILBOX and x[3] and x[3][0] & 2]

    def press(self, key, wait=0.6):
        self.log.clear()
        self.notes.clear()
        self.box.tap(key, wait)
        return list(self.notes), self.mailbox()


def kinds(notes):
    """The note calls without the file opens: on, off and cut (All Notes Off of a part)."""
    return [n[0] for n in notes if n[0] != "open"]


def played(notes):
    return [n for n in notes if n[0] == "on"]


def opens(notes):
    return sum(1 for n in notes if n[0] == "open")


def sounding(messages, part, alive):
    """The preview voices that sound over `messages`, from those in `alive`: a start (0x09 to the part's block) adds its voice,
    a cut (0x26) takes it away; a note-off only releases it, it still sounds. -> the most at once and those left."""
    most = len(alive)
    for m in messages:
        if len(m) > 3 and m[1] == 0x09 and m[2] == 24 + 26 * part:
            alive.add((m[3] - 0x43AB) // 26)
            most = max(most, len(alive))
        elif len(m) > 3 and m[1] == 0x26:
            alive.discard((m[3] - 0x43AB) // 26)
    return most, alive


def strikes(messages):
    """What the messages do to voices: ("cut", v) is a 0x26, ("mask", bits) a 0x36, ("start", v) a 0x09."""
    out = []
    for m in messages:
        if len(m) > 3 and m[1] in (0x26, 0x36, 0x09):
            out.append(("mask", m[3]) if m[1] == 0x36 else ("cut" if m[1] == 0x26 else "start", (m[3] - VOICES) // 26))
    return out


def starts(messages):
    """(voice, DSP address) of every voice start: the 0x01 message to +10 of the voice."""
    return [((m[3] - VOICES) // 26, m[4] << 16 | m[5]) for m in messages
            if len(m) > 5 and m[1] == 0x01 and VOICES <= m[3] < VOICES + 24 * 26 and (m[3] - VOICES) % 26 == 10]


def retrigger(row, v):
    """Korg's retrigger of a MONO part: the voice cut, only its bit in the mask, the start on the same voice."""
    return row == [("cut", v), ("mask", 1 << v), ("start", v)]


def voice(messages, base, period):
    """The voice start of a note on the preview: a 0x01 message hands the DSP `base` (high, low), one the period, and the
    0x2E message makes it a mono voice (type 0)."""
    start = any(len(m) > 5 and m[1] == 0x01 and (m[4] << 16 | m[5]) == base for m in messages)
    rate = any(len(m) > 5 and m[1] == 0x01 and m[4] == period and m[5] == 0 for m in messages)
    mono = [m[3] for m in messages if len(m) > 3 and m[1] == 0x2E]
    return start, rate, mono


def case_plays(payload, flash):
    p = Preview(payload, flash)
    out = [entry("browser", p.browser(), f"screen {p.screen()}")]
    before = p.snapshot()
    base = p.base()
    p.cursor_to("a.wav")
    notes, messages = p.press("play", 0.3)
    want = mono16(FILES["/a.wav"], 1, 16)
    start, rate, mono = voice(messages, base, PERIOD["/a.wav"])
    out.append(entry("a_wav_in_the_dsp_above_the_free_pointer", p.box.dsp_bytes(base, len(want)) == want,
                     f"base {base:#x}, {len(want)} bytes"))
    out.append(entry("a_wav_one_note_on_the_selected_part", [n[:5] for n in notes if n[0] == "on"] == [("on", 0, 0x40, 60, 100)]
                     and opens(notes) == 1, f"{notes}"))
    _, alive = sounding(messages, 0, set())
    out.append(entry("a_wav_voice_plays_the_preview", start and rate and mono == [0], f"start {start}, period {rate}, types {mono}"))
    after = p.snapshot()
    out.append(entry("nothing_else_changes", after == before, f"{[k for k in before if before[k] != after[k]]}"))
    out.append(entry("stays_in_the_browser", p.screen() == (BROWSER, 0), f"{p.screen()}"))
    first = set(alive)
    notes, messages = p.press("play", 0.3)
    most, alive = sounding(messages, 0, alive)
    start, _, _ = voice(messages, base, PERIOD["/a.wav"])
    out.append(entry("play_again_starts_anew_without_reading", kinds(notes) == ["off", "on"] and notes[0][1] == 0 and not opens(notes)
                     and start and most == 1 and alive == first,
                     f"{notes}, preview voices before {first}, at most {most} at once, now {alive}, start {start}"))
    p.log.clear()
    p.notes.clear()
    for _ in range(6):                                          # fast taps, as for a melody
        p.box.tap("play", 0.12, hold=0.05)
    most, alive = sounding(p.mailbox(), 0, alive)
    taps = kinds(p.notes)
    out.append(entry("fast_taps_one_voice_at_a_time", taps == ["off", "on"] * 6 and not opens(p.notes) and most == 1
                     and len(alive) == 1, f"calls {taps}, file opens {opens(p.notes)}, at most {most} preview voices at once"))
    p.log.clear()
    p.notes.clear()
    p.cursor_to("b.wav")
    out.append(entry("dial_stops", [n[0] for n in p.notes][:1] == ["off"], f"{p.notes}"))
    notes, messages = p.press("play")
    want = mono16(FILES["/b.wav"], 2, 24)
    start, rate, mono = voice(messages, base, PERIOD["/b.wav"])
    out.append(entry("b_wav_24_bit_stereo_as_16_bit_mono", p.box.dsp_bytes(base, len(want)) == want and start and rate and mono == [0],
                     f"start {start}, period {rate}, types {mono}, notes {notes}"))
    out.append(entry("no_assertion", not p.m.asserts, p.m.asserts))
    return out


def case_stops(payload, flash):
    p = Preview(payload, flash)
    out = [entry("stop_browser", p.browser(), f"screen {p.screen()}")]
    p.cursor_to("a.wav")
    _, messages = p.press("play")
    _, alive = sounding(messages, 0, set())
    notes, _ = p.press("stop")
    out.append(entry("stop_stops", [n[0] for n in notes] == ["off"], f"{notes}"))
    notes, messages = p.press("play")
    most, alive = sounding(messages, 0, alive)
    out.append(entry("play_after_stop_cuts_and_plays_without_reading", kinds(notes) == ["on"] and not opens(notes)
                     and most == 1 and len(alive) == 1, f"{notes}, at most {most} preview voices at once"))
    p.press("stop")
    p.cursor_to("KORG")
    p.press("play")
    p.notes.clear()
    p.box.tap("menu", 1.0)
    base = p.base()
    found = p.cursor_to("k.wav")
    notes, messages = p.press("play")
    want = mono16(FILES["/KORG/k.wav"], 1, 24)
    start, rate, mono = voice(messages, base, PERIOD["/KORG/k.wav"])
    out.append(entry("a_wav_in_a_folder_plays", found and len(played(notes)) == 1 and p.box.dsp_bytes(base, len(want)) == want
                     and start and rate and mono == [0], f"found {found}, notes {notes}, start {start}, period {rate}, types {mono}"))
    notes, _ = p.press("exit", 1.0)
    out.append(entry("exit_stops_and_leaves", [n[0] for n in notes] == ["off"] and p.screen()[0] != BROWSER, f"{notes}, {p.screen()}"))
    out.append(entry("stop_no_assertion", not p.m.asserts, p.m.asserts))
    return out


def case_errors(payload, flash):
    p = Preview(payload, flash)
    out = [entry("errors_browser", p.browser(), f"screen {p.screen()}")]
    before = dict(p.box.dsp)
    p.cursor_to("KORG")
    notes, _ = p.press("play")
    out.append(entry("folder_does_nothing", not notes and p.screen() == (BROWSER, 0) and p.box.dsp == before, f"{notes}, {p.screen()}"))
    p.cursor_to("c.wav")
    notes, _ = p.press("play")
    window = p.screen()[1]
    out.append(entry("bad_file_format_error", not played(notes) and window and p.u32(window) == ERROR_CLASS and p.u32(LAST_ERROR) == 32
                     and p.box.dsp == before, f"{notes}, window {window:#x}, code {p.u32(LAST_ERROR)}"))
    p.box.tap("exit", 0.6)
    out.append(entry("exit_closes_the_window", p.screen() == (BROWSER, 0), f"{p.screen()}"))
    p.cursor_to("d.wav")
    notes, _ = p.press("play")
    out.append(entry("empty_wav_no_data", not played(notes) and p.screen()[1] and p.u32(LAST_ERROR) == 16 and p.box.dsp == before,
                     f"{notes}, code {p.u32(LAST_ERROR)}"))
    p.box.tap("exit", 0.6)
    cursor = p.u32(CURSOR)
    p.uc.mem_write(CURSOR, struct.pack("<I", DSP_END - 1000))        # a nearly full DSP
    base = p.base()
    p.cursor_to("a.wav")
    notes, messages = p.press("play")
    frames = (DSP_END - base) // 2
    want = mono16(FILES["/a.wav"], 1, 16)[:frames * 2]
    end = any(len(m) > 5 and m[1] == 0x01 and (m[4] << 16 | m[5]) == (frames - 1) * 2 - 4 for m in messages)
    out.append(entry("long_file_plays_its_beginning", len(played(notes)) == 1 and p.box.dsp_bytes(base, len(want)) == want and end,
                     f"{frames} frames from {base:#x}, end {end}"))
    p.uc.mem_write(CURSOR, struct.pack("<I", DSP_END))
    notes, _ = p.press("play")
    window = p.screen()[1]
    out.append(entry("full_dsp_memory_full", "on" not in [n[0] for n in notes] and window and p.u32(LAST_ERROR) == 33,
                     f"{notes}, code {p.u32(LAST_ERROR)}"))
    p.box.tap("exit", 0.6)
    p.uc.mem_write(CURSOR, struct.pack("<I", cursor))
    out.append(entry("errors_no_assertion", not p.m.asserts, p.m.asserts))
    return out


def case_no_part(payload, flash):
    p = Preview(payload, flash, live=())
    out = [entry("no_part_browser", p.browser(), f"screen {p.screen()}")]
    before = dict(p.box.dsp)
    p.cursor_to("a.wav")
    notes, _ = p.press("play")
    window = p.screen()[1]
    out.append(entry("no_sample_part_no_data", not notes and window and p.u32(LAST_ERROR) == 16 and p.box.dsp == before,
                     f"{notes}, code {p.u32(LAST_ERROR)}"))
    return out


def rights_to_import():
    """The number of PART > presses from the first DATA UTILITY page to IMPORT SAMPLE (measured with BLECH's titles)."""
    return 8


def case_kill(payload, flash):
    p = Preview(payload, flash, held=KILL)
    out = [entry("kill_browser", p.browser(rights_to_import()), f"screen {p.screen()}")]
    before = dict(p.box.dsp)
    p.cursor_to("a.wav")
    notes, _ = p.press("play")
    out.append(entry("exit_at_power_on_play_does_nothing", not notes and p.box.dsp == before and p.screen() == (BROWSER, 0),
                     f"{notes}, {p.screen()}"))
    return out


def case_import_after(payload, flash):
    """PLAY, then ENTER imports as before (the card gets the WAV); afterwards (the swap on) the preview still plays."""
    p = Preview(payload, flash)
    out = [entry("import_browser", p.browser(), f"screen {p.screen()}")]
    p.cursor_to("a.wav")
    p.press("play")
    p.notes.clear()
    for key, wait in (("menu", 1.0),):
        p.box.tap(key, wait)
    stopped = [n[0] for n in p.notes][:1] == ["off"]
    p.box.dev.turn(2, 1.0)
    p.box.tap("menu", 3.0)
    p.box.tap("menu", 1.0)
    volume = c.fat32.Volume(bytes(p.m.mmc.card.medium.data))
    try:
        library = volume.read(f"KORG/{c.cardstore.card_folder(p.box.payload)}/Sample/e2sSample.all")
    finally:
        volume.close()
    wave = FILES["/a.wav"]
    pcm = wave[wave.index(b"data") + 8:]
    imported = pcm in library
    out.append(entry("enter_stops_and_imports_as_before", stopped and imported, f"stopped {stopped}, on the card {imported}"))
    p.box.to_main()
    found = p.browser()
    base = p.base()
    p.cursor_to("b.wav")
    notes, messages = p.press("play")
    want = mono16(FILES["/b.wav"], 2, 24)
    start, rate, _ = voice(messages, base, PERIOD["/b.wav"])
    out.append(entry("plays_after_an_import", found and len(played(notes)) == 1 and p.box.dsp_bytes(base, len(want)) == want
                     and start and rate, f"mode {p.box.state('MODE')}, notes {notes}, start {start}, period {rate}"))
    out.append(entry("import_no_assertion", not p.m.asserts, p.m.asserts))
    return out


def case_retrigger(payload, flash):
    """PLAY tapped fast strikes as Korg retriggers a MONO part from its pad (measured in the same box: part 1 on Mono2, pad 1
    tapped): the note-off and the note-on of a tap, the voice cut and started again, the same voice for every strike, and it
    plays the preview. The part stays POLY (Korg's init pattern: Poly2), so the old preview took the next voice each time. The
    dial alone sends the note-off and starts no voice; PLAY on the new file cuts the part before the read and plays it."""
    p = Preview(payload, flash)
    out = [entry("retrigger_browser", p.browser(), f"screen {p.screen()}")]
    obj = p.u32(c.PATPTR)
    poly = p.uc.mem_read(obj + 4 + 0x802, 1)[0]
    base = p.base()
    p.cursor_to("a.wav")
    _, messages = p.press("play", 0.3)
    first = [v for kind, v in strikes(messages) if kind == "start"]
    rows = []
    for _ in range(6):                                          # fast taps, 170 ms apart
        p.log.clear()
        p.notes.clear()
        p.box.tap("play", 0.12, hold=0.05)
        rows.append((kinds(p.notes), strikes(p.mailbox()), starts(p.mailbox())))
    v = first[0] if len(first) == 1 else None
    out.append(entry("retrigger_like_korgs_mono_on_one_voice", poly == 3 and v is not None
                     and all(k == ["off", "on"] and retrigger(s, v) and st == [(v, base)] for k, s, st in rows),
                     f"VOICE ASSIGN {poly}, first voice {first}, per tap (calls, voice messages, starts): {rows}"))
    p.log.clear()
    p.notes.clear()
    p.cursor_to("b.wav")
    out.append(entry("dial_alone_strikes_nothing", kinds(p.notes) == ["off"] and not starts(p.mailbox())
                     and "start" not in [s[0] for s in strikes(p.mailbox())], f"{kinds(p.notes)}, {strikes(p.mailbox())}"))
    notes, messages = p.press("play", 0.5)
    want = mono16(FILES["/b.wav"], 2, 24)
    out.append(entry("play_after_the_dial_plays_the_new_file", kinds(notes) == ["cut", "on"] and opens(notes) == 1
                     and [a for _, a in starts(messages)] == [base] and p.box.dsp_bytes(base, len(want)) == want,
                     f"{kinds(notes)}, starts {[(x, hex(a)) for x, a in starts(messages)]}"))
    p.box.to_main()
    p.box.dev.call(VA_SETTER, obj + PARTS, 0, 1, 1)              # Korg's own: part 1 on Mono2, pad 1 tapped twice
    p.box.run(0.5)
    korg = []
    for _ in range(2):
        p.log.clear()
        p.m.send([0x04, 0, 0, 100, 1])
        p.box.run(0.05)
        p.m.send([0x04, 0, 0, 0, 0])
        p.box.run(0.12)
        korg.append(strikes(p.mailbox()))
    k = [x for kind, x in korg[0] if kind == "start"]
    out.append(entry("korg_retriggers_a_mono_part_so", len(k) == 1 and retrigger(korg[1], k[0]), f"{korg}"))
    out.append(entry("retrigger_no_assertion", not p.m.asserts, p.m.asserts))
    return out


def case_piled_up(payload, flash):
    """PLAY tapped on while a long WAV is read and the dial turned before the read is over (the UI reads, the keys wait and come
    all at once after it): every voice that starts plays the preview, never the part's own sample. Then PLAY plays the file
    under the cursor."""
    p = Preview(payload, flash)
    out = [entry("piled_up_browser", p.browser(), f"screen {p.screen()}")]
    base = p.base()
    p.cursor_to("long.wav")
    names, at = p.names()
    p.log.clear()
    p.notes.clear()
    for _ in range(4):
        p.box.tap("play", 0.05, hold=0.03)
    p.box.dev.turn(names.index("b.wav") - at, 0.05)
    sent = p.m.time_ns / 1e9
    p.box.run(2.5)
    on = [n[-1] for n in p.notes if n[0] == "on"]
    out.append(entry("keys_came_during_the_read", opens(p.notes) == 1 and on and on[0] > sent and kinds(p.notes)[-1] == "off",
                     f"calls {kinds(p.notes)}, first note-on {on[:1]} s, dial sent {sent:.2f} s"))
    heard = starts(p.mailbox())
    out.append(entry("piled_up_keys_play_only_the_preview", heard and all(a == base for _, a in heard),
                     f"starts {[(x, hex(a)) for x, a in heard]}, the preview at {base:#x}"))
    found = p.cursor_to("b.wav")                                # the late dial steps land elsewhere; the next file by hand
    notes, messages = p.press("play", 0.5)
    want = mono16(FILES["/b.wav"], 2, 24)
    heard = starts(messages)
    out.append(entry("then_the_next_file", found and opens(notes) == 1 and len(heard) == 1 and heard[0][1] == base
                     and p.box.dsp_bytes(base, len(want)) == want,
                     f"found {found}, {kinds(notes)}, starts {[(x, hex(a)) for x, a in heard]}"))
    out.append(entry("piled_up_no_assertion", not p.m.asserts, p.m.asserts))
    return out


GROUPS = (case_plays, case_stops, case_errors, case_no_part, case_kill, case_import_after, case_retrigger, case_piled_up)


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
