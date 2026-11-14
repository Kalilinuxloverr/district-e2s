"""Emulator cases of plugin API 27: korg.menu.group puts a page of korg.menu.add behind the pages of FEATURES or CUSTOMIZATION or
into DEV, a group of the list that is only there while it has a page; korg.menu.text shows a text in place of a page's number and
korg.menu.value another number, on the screen at once; the menu holds 64 pages; korg.read.ram reads a word of RAM and refuses every
address outside the RAM window; the page VERSION names the fork; a block of API 26 runs as before.

    PYTHONPATH=tools/patch python3 tools/emu/plugin_api27_cases.py --vsb PATCHED.VSB [--flash FLASH.BIN]

The measurements are in docs/messungen/2026-11-13-plugin-api27.md.
"""
import argparse
import json
import re
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).parent))

from tools.patch import script_hooks  # noqa: E402
import menu_cases  # noqa: E402
import plugin_edit_cases as edit  # noqa: E402
import script_cases  # noqa: E402
from firmware import identify  # noqa: E402
from machine import load_flash  # noqa: E402

STATE = script_hooks.MENU_STATE
S_ITEMS, S_NOTE = 60, 0x190          # M_ITEMS_N, M_BRW_NOTE (script_menu.s)
NOTE_ONLY = 3                        # BRW_NOTE_ONLY: the page keeps its lines and has the line of M_BRW_NOTE under them
NOTE_ROWS = range(47, 64)            # under the value (the firmware's lines end at row 46)
GROUP_DEV = 10                       # M_GROUP_DEV
PAGES = 64                           # SCRIPT_MENU.pages
ARMED, DISABLED = 2, 3               # SCRIPT_STATE
API_ARG = 15                         # ERROR.API_ARG
HDR_API_VERSION = 6
FOLDER = "/KORG/blechtribe/Plugin/"
OPS = {"ram": 1, "value": 2, "text": 3, "number": 4, "other": 5}
MAIN = """let cmd = 0; let done = 0; let a = 0; let out = 0; let seen = -1; let seenId = -1;
let pf = korg.menu.add("FEAT PAGE", 0, 4, 1);
let pc = korg.menu.add("CUSTOM PAGE", 0, 9, 2);
let pd = korg.menu.add("DEV PAGE", 0, 99999, 3);
let own = korg.menu.add("OWN PAGE", 0, 9, 4);
korg.menu.group(pf, "FEATURES");
korg.menu.group(pc, "CUSTOMIZATION");
korg.menu.text(pf, "FADE");
korg.onEvent("ready", () => { korg.menu.group(pd, "DEV"); });
korg.onEvent("menu", (id, value) => {
  seenId = id; seen = value;
  if (id != pf) return;
  if (value == 0) korg.menu.text(pf, "OFF");
  if (value == 1) korg.menu.text(pf, "FADE");
  if (value == 2) korg.menu.text(pf, "");
  if (value == 3) korg.menu.text(pf, "A TEXT OF 20 LETTERS");
});
korg.onEvent("frame", () => {
  if (cmd == done) return;
  done = cmd;
  let op = cmd & 15;
  if (op == 1) out = korg.read.ram(a);
  if (op == 2) korg.menu.value(pd, a);
  if (op == 3) korg.menu.text(pd, "ADAPTER");
  if (op == 4) korg.menu.text(pd, "");
  if (op == 5) { korg.menu.text(a, "TAKEN"); korg.menu.value(a, 7); }
});"""
# a block that uses nothing newer than API 26: the compiler gives it that version
OLD = """let p = korg.menu.add("OLD PAGE", 0, 9, 4); let seen = -1; let unsaved = -1;
korg.onEvent("menu", (id, value) => { if (id == p) seen = value; });
korg.onEvent("frame", () => { unsaved = korg.read.unsaved(); });"""
TOOL = """korg.app("Tool", "TOOLS");
korg.onEvent("frame", () => { korg.display.clear(); });"""
MANY = "\n".join(f'let p{i} = korg.menu.add("page{i}", 0, 9, {i % 10});' for i in range(30))
# a plugin that is only a file of the folder: loaded from the menu, after the first one was taken out
LATE = """let d = korg.menu.add("LATE DEV", 0, 9, 6); let o = korg.menu.add("LATE OWN", 0, 9, 7);
korg.menu.group(d, "DEV");"""
SOURCES = {"api27": MAIN, "old26": OLD, "tool": TOOL, "manyA": MANY, "manyB": MANY, "late": LATE}
ON_CARD = ["api27", "old26", "tool", "manyA", "manyB"]      # e2sPlugin.all, in this order: the list of MANAGE PLUGINS has them so


def node_requests():
    """Every answer this module asks Node for (node_json.py); tools/emu/node_results.py keeps them in its file."""
    edit.compiled(SOURCES)


def entry(name, ok, detail):
    return {"id": f"plugin_api27:{name}", "ok": bool(ok), "detail": str(detail)}


class World:
    """A booted device on mains power with the plugins of the card running; `post` hands the first plugin a command for its next frame."""

    def __init__(self, vsb, flash, built, programs):
        blob = lambda name: bytes.fromhex(programs[name]["blob"])
        files = {**menu_cases.CARD_FOLDER, script_cases.CARD_FILE: script_cases.archive([blob(n) for n in ON_CARD]), FOLDER + "late.blech": blob("late")}
        self.dev = menu_cases.boot(vsb[0x100:], flash, files=files, adapter=True, seconds=2.5)
        self.built, self.programs, self.seq = built, programs, 0
        self.runtime = built.layout["runtime"]
        self.dev.run(0.5)

    def at(self, name):
        return script_cases.plugin_entry(self.dev, self.runtime, ON_CARD.index(name))

    def vars(self, name="api27"):
        return script_cases.variables(self.dev, self.at(name), self.programs[name])

    def state(self, name="api27"):
        return self.dev.u32(self.at(name) + 12), self.dev.u32(self.at(name) + 16)

    def poke(self, var, value):
        base = self.dev.u32(self.at("api27") + 8)
        self.dev.m.uc.mem_write(base + self.programs["api27"]["symbols"][var]["slot"] * 4, struct.pack("<I", value & 0xFFFFFFFF))

    def post(self, op, a=0, wait=0.2):
        self.seq += 1
        self.poke("a", a)
        self.poke("cmd", self.seq * 16 + OPS[op])
        self.dev.run(wait)
        return self.vars()["out"]

    def shown(self):
        return menu_cases.texts_of(self.dev), menu_cases.counter(self.dev), menu_cases.tab(self.dev)

    def rows(self):
        """The titles of the list of level 1, from its first row on."""
        dev = self.dev
        menu_cases.goto_top(dev, 0)
        out = []
        for _ in range(menu_cases.counter(dev)[1]):
            out.append(menu_cases.text(dev, menu_cases.S_TITLE))
            menu_cases.press(dev, "edit_next")
        return out

    def pages_of(self, group):
        """The titles of the pages of a group of level 2."""
        dev = self.dev
        menu_cases.goto_group(dev, group, 0)
        out = []
        for _ in range(menu_cases.counter(dev)[1]):
            out.append(menu_cases.text(dev, menu_cases.S_TITLE))
            menu_cases.press(dev, "edit_next")
        return out


def version_cases(w, payload):
    dev = w.dev
    rows = w.rows()
    last = len(rows) - 1
    menu_cases.goto_top(dev, last)
    dev.run(0.3)
    texts, mode, note = menu_cases.texts_of(dev), dev.read(STATE + menu_cases.S_BRW_ON, 1)[0], menu_cases.text(dev, S_NOTE)
    ink = menu_cases.lit(menu_cases.frame(dev), NOTE_ROWS)
    columns = (min(x for x, _ in ink), max(x for x, _ in ink)) if ink else None
    menu_cases.press(dev, "edit_next", wait=0.4)
    left = (menu_cases.text(dev, menu_cases.S_TITLE), dev.read(STATE + menu_cases.S_BRW_ON, 1)[0], len(menu_cases.lit(menu_cases.frame(dev), NOTE_ROWS)))
    return [entry("version_page_names_the_fork", texts == (*menu_cases.version_texts(payload), "") and mode == NOTE_ONLY
                  and re.fullmatch(rf".+ {re.escape(script_hooks.DISTRICT_NUMBER)}", note)
                  and columns and columns[0] >= 1 and columns[1] <= 126 and left == ("FEATURES", 0, 0) and not dev.m.asserts,
                  f"lines {texts}, under them {note!r} in columns {columns} of rows {NOTE_ROWS.start} to {NOTE_ROWS.stop - 1}; "
                  f"on the next row {left[0]!r} those rows have {left[2]} pixels")]


def group_cases(w):
    out = []
    dev = w.dev
    title = menu_cases.version_texts(dev.read(0xC0000000, 0x200000))[0]
    rows = w.rows()
    out.append(entry("dev_is_a_group_between_tools_and_version", rows == ["FEATURES", "PLUGINS", "CUSTOMIZATION", "TOOLS", "DEV", title], f"the list: {rows}"))

    # FEATURES: the firmware's pages, then the plugin's, with its text; the dial changes the value and the plugin answers with a text
    own = menu_cases.feature_pages()
    features = w.pages_of(menu_cases.GROUP_FEATURES)
    menu_cases.goto_group(dev, menu_cases.GROUP_FEATURES, len(own))
    first = w.shown()
    steps = []
    for delta in (-1, 2, 1, -2):
        before = menu_cases.lit(menu_cases.frame(dev), range(30, 47))
        dev.turn(delta, wait=0.3)
        steps.append((menu_cases.text(dev, menu_cases.S_VALUE), w.vars()["seen"], menu_cases.lit(menu_cases.frame(dev), range(30, 47)) != before))
    out.append(entry("features_page_behind_the_firmwares_pages", features == own + ["FEAT PAGE"] and first == (("FEAT PAGE", "FADE", ""), (len(own), len(own) + 1), "Feature"),
                     f"FEATURES: {features}; the page {first}"))
    out.append(entry("text_value_follows_the_dial", steps == [("OFF", 0, True), ("2", 2, True), ("A TEXT OF 20 LE", 3, True), ("FADE", 1, True)]
                     and w.vars()["seenId"] == w.vars()["pf"] and w.state() == (ARMED, 0) and not dev.m.asserts,
                     f"dial -1, +2, +1, -2: value shown, value the plugin got, screen changed: {steps} (the empty text shows the number, a text of 20 letters is cut to 15)"))

    # CUSTOMIZATION: its rows, then the plugin's page as a number; ENTER does nothing on it
    custom = w.pages_of(menu_cases.GROUP_CUSTOM)
    menu_cases.goto_group(dev, menu_cases.GROUP_CUSTOM, len(custom) - 1)
    first = w.shown()
    dev.turn(1, wait=0.3)
    menu_cases.press(dev, "menu", wait=0.3)
    after = (menu_cases.texts_of(dev), menu_cases.state(dev, menu_cases.S_LEVEL), menu_cases.state(dev, menu_cases.S_GROUP), w.vars()["seen"], w.vars()["seenId"] == w.vars()["pc"])
    out.append(entry("customization_page_behind_its_rows", custom[-1] == "CUSTOM PAGE" and custom[:2] == ["DISPLAY", "LED"] and "CUSTOM PAGE" not in custom[:-1]
                     and first == (("CUSTOM PAGE", "2", ""), (len(custom) - 1, len(custom)), "Custom") and after == (("CUSTOM PAGE", "3", ""), 2, menu_cases.GROUP_CUSTOM, 3, True),
                     f"CUSTOMIZATION: {custom}; the page {first}, after the dial and ENTER {after}"))

    # DEV: ENTER on its row opens its pages, EXIT goes back to the row
    menu_cases.goto_top(dev, rows.index("DEV"))
    menu_cases.press(dev, "menu", wait=0.4)
    inside = (menu_cases.state(dev, menu_cases.S_LEVEL), menu_cases.state(dev, menu_cases.S_GROUP), w.shown())
    menu_cases.press(dev, "exit", wait=0.4)
    back = (menu_cases.state(dev, menu_cases.S_LEVEL), menu_cases.state(dev, menu_cases.S_PAGE), menu_cases.texts_of(dev))
    out.append(entry("dev_group_opens_and_exits", inside == (2, GROUP_DEV, (("DEV PAGE", "3", ""), (0, 1), "Dev")) and back == (1, rows.index("DEV"), ("DEV", "", menu_cases.PRESS))
                     and not menu_cases.page_overlap(dev), f"ENTER on DEV: {inside}, EXIT: {back}"))

    # the plugin's own pages under PLUGINS no longer have the three pages it moved
    menu_cases.goto_plugin(dev, ON_CARD.index("api27"), 2)
    own_page = w.shown()
    out.append(entry("grouped_pages_leave_the_plugins_own", own_page == (("OWN PAGE", "4", ""), (2, 5), "Plugins"),
                     f"the plugin's pages are ACTIVE, DESCRIPTION, its page, OFF and REMOVE: page 3 is {own_page}"))
    return out


def value_cases(w):
    out = []
    dev = w.dev
    menu_cases.goto_group(dev, GROUP_DEV, 0)
    events = w.vars()["seen"]
    seen = []
    for op, a in (("value", 1234), ("text", 0), ("number", 0), ("value", 200000), ("value", -5)):
        w.post(op, a)
        seen.append((menu_cases.text(dev, menu_cases.S_VALUE), tuple(sorted(menu_cases.lit(menu_cases.frame(dev), range(30, 47))))))
    texts = [s[0] for s in seen]
    drawn = len({s[1] for s in seen})
    out.append(entry("value_and_text_show_at_once", texts == ["1234", "ADAPTER", "1234", "99999", "0"] and drawn == 4 and seen[0][1] == seen[2][1]
                     and w.vars()["seen"] == events and w.state() == (ARMED, 0) and not dev.m.asserts,
                     f"korg.menu.value 1234, korg.menu.text, the empty text, values above and below the range, while the page shows: {texts}, "
                     f"{drawn} different pictures of the value row, no menu event for the plugin's own calls"))

    # the page of another plugin, the page that was refused (-1) and one never added: nothing changes, nothing faults
    theirs = w.vars("old26")["p"]
    for page in (theirs, -1, PAGES - 1):
        w.post("other", page)
    menu_cases.goto_plugin(dev, ON_CARD.index("old26"), 2)
    kept = menu_cases.texts_of(dev)
    out.append(entry("another_plugins_page_is_left_alone", kept == ("OLD PAGE", "4", "") and w.state() == (ARMED, 0) and w.state("old26") == (ARMED, 0),
                     f"text and value for page {theirs} of the other plugin, for -1 and for {PAGES - 1}: its page shows {kept}, both plugins run"))
    return out


def many_cases(w):
    dev = w.dev
    a, b = w.vars("manyA"), w.vars("manyB")
    total = dev.u32(STATE + S_ITEMS)
    menu_cases.goto_plugin(dev, ON_CARD.index("manyA"), 2 + 29)
    last = menu_cases.texts_of(dev)
    first_b = b["p0"]
    return [entry("the_menu_holds_64_pages", total == PAGES and a["p29"] == a["p0"] + 29 and b[f"p{PAGES - 1 - first_b}"] == PAGES - 1
                  and b[f"p{PAGES - first_b}"] == -1 and b["p29"] == -1 and last == ("page29", "9", "") and w.state("manyB") == (ARMED, 0) and not dev.m.asserts,
                  f"{total} pages of five plugins; the 30th page of the fourth is {last}, the fifth got the numbers {first_b} to {PAGES - 1} and then -1")]


def old_cases(w):
    dev = w.dev
    version = struct.unpack_from("<H", bytes.fromhex(w.programs["old26"]["blob"]), HDR_API_VERSION)[0]
    menu_cases.goto_plugin(dev, ON_CARD.index("old26"), 2)
    dev.turn(3, wait=0.3)
    got = (menu_cases.texts_of(dev), w.vars("old26")["seen"], w.vars("old26")["unsaved"])
    return [entry("api26_block_runs_unchanged", version == 26 and got == (("OLD PAGE", "7", ""), 7, 0) and w.state("old26") == (ARMED, 0),
                  f"a block of API {version} beside the new ones: its page under PLUGINS after the dial {got[0]}, its menu event {got[1]}, korg.read.unsaved in its frame {got[2]}")]


def ram_cases(w):
    out = []
    dev = w.dev
    signed = lambda v: struct.unpack("<i", struct.pack("<I", v))[0]
    dev.m.uc.mem_write(0xC7FFFFFC, struct.pack("<I", 0x89ABCDEF))
    inside = [STATE + S_ITEMS, menu_cases.HW_TEMPO, menu_cases.HW_TEMPO + 1, 0xC0000000, 0xC0000003, 0xC7FFFFFC]
    got = [w.post("ram", at) for at in inside]
    want = [signed(struct.unpack("<I", dev.read(at, 4))[0]) for at in inside]
    out.append(entry("read_ram_inside_the_window", got == want and got[0] == PAGES and got[-1] == signed(0x89ABCDEF) and w.state() == (ARMED, 0),
                     f"{[hex(at) for at in inside]}: {got} (the RAM holds {want})"))
    refused = []
    for at in (0xBFFFFFFC, 0xC7FFFFFD, 0xC8000000, 0x01E26098, 0x01C21010, 0x60000000, 0, 0xFFFF0000):
        dev.m.uc.mem_write(w.at("api27") + 12, struct.pack("<II", ARMED, 0))       # on again after the fault of the address before
        w.poke("out", 0x5A5A)
        result = w.post("ram", at)
        refused.append((hex(at), result == 0x5A5A, w.state()))
    out.append(entry("read_ram_outside_is_an_argument_fault", all(kept and state == (DISABLED, API_ARG) for _, kept, state in refused) and not dev.m.asserts,
                     f"address, nothing returned, the plugin's state and fault: {refused}"))
    return out


def take_out_cases(w):
    """OFF takes the first plugin out: DEV and its pages in FEATURES and CUSTOMIZATION go with it. A plugin loaded from its file
    afterwards finds the places of those pages free although the table was full, and DEV is back."""
    out = []
    dev = w.dev
    dev.m.uc.mem_write(w.at("api27") + 12, struct.pack("<II", ARMED, 0))
    custom = len(w.pages_of(menu_cases.GROUP_CUSTOM)) - 1
    menu_cases.goto_plugin(dev, ON_CARD.index("api27"), 3)
    off_page = menu_cases.text(dev, menu_cases.S_TITLE)
    menu_cases.press(dev, "menu", wait=0.4)
    menu_cases.press(dev, "menu", wait=1.0)
    rows = w.rows()
    features, customs = w.pages_of(menu_cases.GROUP_FEATURES), w.pages_of(menu_cases.GROUP_CUSTOM)
    out.append(entry("dev_goes_with_its_last_page", off_page == "OFF" and "DEV" not in rows and rows[:4] == ["FEATURES", "PLUGINS", "CUSTOMIZATION", "TOOLS"] and len(rows) == 5
                     and features == menu_cases.feature_pages() and len(customs) == custom and dev.u32(STATE + S_ITEMS) == PAGES and not dev.m.asserts,
                     f"after OFF on the plugin: the list {rows}, FEATURES {len(features)} pages, CUSTOMIZATION {len(customs)} rows"))
    # MANAGE PLUGINS, ENTER reads the folder; the file is the last of the list; ENTER opens its pages, the dial up on ACTIVE loads it
    menu_cases.goto_group(dev, menu_cases.GROUP_PLUGINS, menu_cases.PLUGIN_MANAGE)
    menu_cases.press(dev, "menu", wait=0.6)
    dev.turn(20, wait=0.4)
    menu_cases.press(dev, "menu", wait=0.5)
    dev.turn(1, wait=0.8)
    dev.run(0.5)
    late = script_cases.plugin_entry(dev, w.runtime, len(ON_CARD))
    got = script_cases.variables(dev, late, w.programs["late"]) if late else {}
    rows = w.rows()
    pages = w.pages_of(GROUP_DEV) if "DEV" in rows else []
    out.append(entry("dev_comes_with_a_plugin_and_freed_places_are_taken", bool(late) and dev.u32(late + 12) == ARMED and got == {"d": 0, "o": 1} and dev.u32(STATE + S_ITEMS) == PAGES
                     and rows[3:5] == ["TOOLS", "DEV"] and pages == ["LATE DEV"] and not dev.m.asserts,
                     f"a plugin loaded from its file with the table full: its pages got the numbers {got}, the list {rows}, DEV {pages}"))
    return out


def cases(vsb, flash=None):
    payload = vsb[0x100:]
    menu_cases.for_build(payload)
    build = identify(payload).build
    request = edit.compiled(SOURCES)
    built = script_hooks.build(request["include"], build=build)
    w = World(vsb, flash, built, request["programs"])
    states = {name: w.state(name) for name in ON_CARD}
    if any(state != (ARMED, 0) for state in states.values()):
        return [entry("plugins_run", False, f"state and fault of the plugins of the card: {states}")]
    out = version_cases(w, payload)
    out += group_cases(w)
    out += value_cases(w)
    out += many_cases(w)
    out += old_cases(w)
    out += ram_cases(w)
    out += take_out_cases(w)
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
