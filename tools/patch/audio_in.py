"""Builds the audio-in patch for the red Sampler 2.02 (Korg's build): AUDIO IN PAD, PANIC and the Audio In buffer.

AUDIO IN PAD: in TRIGGER mode a tap on pad 16 latches Audio In on part 16, the next tap ends it. The patch plays a note of its
own on part 16 (source AI_SRC, not the pads' 0x40, so no pad release, mode change or menu ends it) and, while it is latched,
the part's sound setup in the voice task (0xC0099D88) reads Audio In instead of the part's sample, Mn (oscillator 017) or St
(018) as the page AUDIO IN PAD says at the tap (1 MONO, 2 STEREO): the hook at
0xC0099D90 replaces only what the sound engine reads, the pattern in RAM keeps its sample, so the pattern stays saved (the
firmware's compare and AUTO WRITE see no change). The part's own sound setup (0xC009B5EC, what EXIT + pad calls) then hands
the voices the Audio In program; filter, EG, insert effect, MFX send, level and pan stay those of part 16. A pattern change,
PANIC or the second tap end it, and the part's own sample comes back the same way. Pad 16 lights red while it is latched, in
TRIGGER mode. The latched voice's input level (for Audio In OSC EDIT is the input level) is the page AUDIO IN PEGEL (0 to 127,
Korg's default 64 without the page); a change while latched goes to the voice at once, the way Korg's OSC EDIT knob does it
(0xC0099A34: every voice of the part takes its oscillator again).

PANIC: EXIT + STOP. Every part gets the firmware's All Notes Off (0xC00983FC, the path MIDI CC 123 takes), a latched Audio In
ends with it. STOP goes on to the firmware and does what it always does.

Audio In buffer: EXIT + REC, while stopped. Korg's own sampling of Audio In (mono) into the next free slot for the seconds of
the page AUDIO IN PUFFER (at most what the DSP has free), a bar in the sampling window fills meanwhile, then the patch ends the
recording, gives the window its WRITE (the firmware keeps the sample as on a WRITE by hand) and puts the new sample on the part
that was selected. STOP, EXIT or PLAY in the window end the patch's part early and leave the window to the user (WRITE keeps,
EXIT discards, as always). The source and mono setting of the sampling window come back as they were. Not while the sample
swap is on: the recording would go into the swap's library, which no device has confirmed (docs/messungen/2026-11-13-audio-in.md).

The switches are pages of a plugin (plugins/api26/AudioIn.js in the DISTRICT tree, group FEATURES: AUDIO IN PAD, AUDIO IN
PEGEL, AUDIO IN PUFFER, PANIC): the runtime looks a page up by its name (script_shortcuts.s, menu_page_value) and hands the patch
the lookup with every panel message and every frame. Without the plugin, with a page at 0, with EXIT held at power-on or without the runtime, pad 16, STOP and
REC are the firmware's.

Hooks:
  AI_CODE    the runtime's shortcut input and tick call the two entries there (script_shortcuts.s: ai_call_input, ai_call_tick)
  0xC0099D90 ldrh r6, [r3, #8] in the part's sound setup (voice task): Audio In for part 16 while latched
  0xC0099EE8 b 0xC0091828, the part's sound setup's last step, which notes the sound its voices start with (part +0x28): a
             copy that notes the latch's Audio In for part 16, as Korg's own change of the oscillator leaves it, so a note that
             takes over a voice of part 16's sample (still releasing) takes Audio In as well and does not retrigger the sample
  0xC0099904 ldrb r0, [r3, #0xb] where a voice takes its oscillator: AUDIO IN PEGEL as OSC EDIT for part 16's latched voice
Korg's build only: the places are not checked on Hacktribe, a Hacktribe build of the set leaves the patch out.

    python3 tools/patch/audio_in.py --vsb SYSTEM.VSB [--out data/patches/audio-in.json]
"""

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import arm  # noqa: E402
import ramdecl  # noqa: E402
import sample_swap  # noqa: E402

HEADER = 0x100
RAM = 0xC0000000

CODE_AT, CODE_END = 0xC018F000, 0xC018FEC0      # the end of the runtime's second code area, FF in the image; the runtime leaves it
ST, ST_LEN = 0xC018FEC0, 0x40                   # (script_hooks.py:AUDIO_IN); state words, FF at power-on

# state offsets: bytes for the requests (input task) and words for the rest (UI task, the latch also in the voice task)
O_MAGIC, O_LATCH, O_REQ_TOGGLE, O_REQ_PANIC, O_REQ_BUF, O_HELD, O_PATNO = 0, 4, 8, 9, 10, 12, 16
O_PHASE, O_T0, O_LEN, O_PART, O_SRC, O_MODE, O_SECS = 20, 24, 28, 32, 36, 40, 44
O_OSC, O_LEVEL = 48, 52                         # the latch's oscillator (AI_OSC_MN or AI_OSC_ST), its OSC EDIT (-1: the oscillator's own)
MAGIC = 0x314E4941                              # "AIN1": the state was set up after power-on

KIND_SITE, KIND_WAS = 0xC0099D90, 0xE1D360B8    # ldrh r6, [r3, #8]: the part's sample, read by the part's sound setup
OSC_EDIT_SITE, OSC_EDIT_WAS = 0xC0099904, 0xE5D3000B   # ldrb r0, [r3, #0xb]: the part's OSC EDIT, read when a voice takes its oscillator
GEN_SITE, GEN_WAS = 0xC0099EE8, 0xEAFFDE4E      # b 0xC0091828: part +0x28 from the part's sample again (the sound a voice was started
GEN_BACK = 0xC0091830                           # with; a note that takes over a voice with the same sound keeps its oscillator)

FIRMWARE = dict(
    NOTE_ON=0xC005AD44, NOTE_OFF=0xC005A20C, PART=0xC009AF20, OSC_REFRESH=0xC0099FFC, OSC_RETAKE=0xC0099A34,
    NOTES_OFF=0xC00983FC, PLAYER=0xC002FAFC,
    LEDMGR=0xC0345A1C, LEDSEND=0xC00875F4, PANEL=0xC033E6F8, MS=0xC06A292C, UDIV=0xC00021FC,
    TRANSPORT=0xC0030D28, MANAGER=0xC0035AD8, SLOT_FREE=0xC007DE7C, DSP_FREE=0xC004E218, OPEN=0xC0083DB0,
    SET_SOURCE=0xC006B440, SET_STEREO=0xC006B3FC, REC_START=0xC0082F1C, REC_END=0xC0082D40, LOADED=0xC007DEAC,
    PANEL_KEY=0xC0042BB8, SAMPLE_NEXT=0xC0040D50, PART_EDIT=0xC0048460, PART_EDITOR=0xC034886C,
    SCREENS=0xC03404C0, WINDOW=0xC006E9A0, VRAM=0xC031B310, MARK=0xC001531C, SAMPLING_VT=0xC00E3AA8,
)
PAGE_PAD, PAGE_LEVEL, PAGE_BUF, PAGE_PANIC = "AUDIO IN PAD", "AUDIO IN PEGEL", "AUDIO IN PUFFER", "PANIC"   # plugins/api26/AudioIn.js
AI_PART, AI_PAD = 15, 15                        # part 16, pad 16
AI_OSC_MN, AI_OSC_ST = 16, 17                   # oscillators 017 Audio In Mn and 018 Audio In St (import number 45 both,
                                                # docs/messungen/2026-11-13-audio-in.md); AUDIO IN PAD 1 and 2
LEVEL_MAX = 127                                 # OSC EDIT
AI_SRC, AI_NOTE, AI_VEL = 0x50, 60, 127         # the note's source (not a pad's 0x40), the part's root key, full velocity
TRIGGER = 3                                     # LED manager + 0xB58: the pad mode
PAD16_RED = 0x4A                                # pad n red 0x2C + 2n
LED_ON = 0xFD                                   # odd: ours (the firmware's values are even or 255); any value above 0 lights
KEY_REC, KEY_STOP, KEY_WRITE = 0, 1, 0x0E
KILL = 0x2000                                   # PANEL + 0x18: EXIT held at power-on
BYTES_PER_S = 96000                             # mono 16 bit at 48 kHz
STATE_READY, STATE_RECORDING, STATE_DONE = 10, 11, 12    # transport + 0x308 (docs/messungen/2026-11-06-sample-ram-aufnahme.md)
SAMPLING = 42                                   # the sampling window
ERROR_WINDOW, ERR_FULL = 27, 33                 # the firmware's error window, "Memory Full"
OPEN_MS, CONFIRM_MS, WRITE_MS = 1000, 2000, 6000
BAR_X0, BAR_X1, BAR_PAGE = 20, 108, 5           # the bar: columns 20 to 107, rows 41 to 44 (page 5, bits 1 to 4), under the
BAR_EDGE, BAR_OPEN, BAR_FULL = 0x1E, 0x12, 0x1E # window's "Now Sampling!"
PHASE_IDLE, PHASE_OPEN, PHASE_REC, PHASE_CONFIRM, PHASE_WRITE = 0, 1, 2, 3, 4


def source():
    names = {**FIRMWARE, "ST": ST, "MAGIC": MAGIC, "O_MAGIC": O_MAGIC, "O_LATCH": O_LATCH, "O_REQ_TOGGLE": O_REQ_TOGGLE,
             "O_REQ_PANIC": O_REQ_PANIC, "O_REQ_BUF": O_REQ_BUF, "O_HELD": O_HELD, "O_PATNO": O_PATNO, "O_PHASE": O_PHASE,
             "O_T0": O_T0, "O_LEN": O_LEN, "O_PART": O_PART, "O_SRC": O_SRC, "O_MODE": O_MODE, "O_SECS": O_SECS,
             "AI_PART": AI_PART, "AI_PAD": AI_PAD, "AI_OSC_MN": AI_OSC_MN, "AI_OSC_ST": AI_OSC_ST, "AI_SRC": AI_SRC,
             "AI_NOTE": AI_NOTE, "AI_VEL": AI_VEL, "O_OSC": O_OSC, "O_LEVEL": O_LEVEL, "LEVEL_MAX": LEVEL_MAX,
             "GEN_BACK": GEN_BACK,
             "TRIGGER": TRIGGER, "PAD16_RED": PAD16_RED, "LED_ON": LED_ON, "KEY_REC": KEY_REC, "KEY_STOP": KEY_STOP,
             "KEY_WRITE": KEY_WRITE, "KILL": KILL, "BYTES_PER_S": BYTES_PER_S, "STATE_READY": STATE_READY,
             "STATE_RECORDING": STATE_RECORDING, "STATE_DONE": STATE_DONE, "SAMPLING": SAMPLING, "ERROR_WINDOW": ERROR_WINDOW,
             "ERR_FULL": ERR_FULL, "OPEN_MS": OPEN_MS, "CONFIRM_MS": CONFIRM_MS, "WRITE_MS": WRITE_MS, "BAR_X0": BAR_X0,
             "BAR_X1": BAR_X1, "BAR_PAGE": BAR_PAGE, "BAR_EDGE": BAR_EDGE, "BAR_OPEN": BAR_OPEN, "BAR_FULL": BAR_FULL,
             "PHASE_OPEN": PHASE_OPEN, "PHASE_REC": PHASE_REC, "PHASE_CONFIRM": PHASE_CONFIRM, "PHASE_WRITE": PHASE_WRITE,
             "SWAP_MODE": sample_swap.STATE + sample_swap.OFF["MODE"]}
    return "".join(f".equ {k}, {v:#x}\n" for k, v in names.items()) + f".org {CODE_AT:#x}\n" + sample_swap.halfword(SOURCE)


SOURCE = r"""
; the runtime calls these two (script_shortcuts.s: ai_call_input, ai_call_tick)
ai_entries:
    .word ai_input
    .word ai_tick

; ---------------------------------------------------------------- panel messages (from the runtime's shortcut input)
; r0 the message (type +0x0C, data from +0x0D), r1 the runtime's page lookup (r0 a name -> its value, -1 without the page),
; r2 1 while EXIT is held on the main screen. -> r0 1 to drop the message. Only asks: the tick does the work.
ai_input:
    push {r4-r8, lr}
    mov r4, r0
    mov r5, r1
    mov r6, r2
    bl ai_init
    ldr r7, =ST
    ldrb r0, [r4, #0x0c]
    cmp r0, #4
    beq in_pad
    cmp r0, #0
    bne in_pass
    ldrb r1, [r4, #0x0d]
    ldrb r2, [r4, #0x0e]
    cmp r1, #KEY_STOP
    beq in_stop
    cmp r1, #KEY_REC
    bne in_pass
    mov r8, #4
    cmp r2, #0
    beq in_release
    ldr r0, [r7, #O_HELD]
    tst r0, r8                  ; again while it is down: ours
    bne in_drop
    cmp r6, #1
    bne in_pass
    ldr r0, =str_buf
    blx r5
    cmp r0, #0
    ble in_pass                 ; no page, or AUS: REC stays the firmware's
    str r0, [r7, #O_SECS]
    mov r0, #1
    strb r0, [r7, #O_REQ_BUF]
    b in_take
in_stop:                        ; EXIT + STOP: PANIC; STOP goes on to the firmware and stops as always
    cmp r2, #0
    beq in_pass
    cmp r6, #1
    bne in_pass
    ldr r0, =str_panic
    blx r5
    cmp r0, #0
    ble in_pass                 ; no page, or AUS
    mov r0, #1
    strb r0, [r7, #O_REQ_PANIC]
    b in_pass
in_pad:
    ldrb r1, [r4, #0x0d]
    cmp r1, #AI_PAD
    bne in_pass
    mov r8, #1
    ldrb r2, [r4, #0x10]
    cmp r2, #0
    beq in_release
    ldr r0, [r7, #O_HELD]
    tst r0, r8                  ; pressure while it is down: ours
    bne in_drop
    cmp r6, #0                  ; EXIT + pad is BLECH's part reset
    bne in_pass
    ldr r0, =LEDMGR
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    beq in_pass
    ldr r0, [r0, #0xB58]
    cmp r0, #TRIGGER
    bne in_pass
    ldr r0, =str_pad
    blx r5
    cmp r0, #0
    ble in_pass
    strb r0, [r7, #O_REQ_TOGGLE]   ; the page's value: 1 MONO, 2 STEREO
in_take:
    ldr r0, [r7, #O_HELD]
    orr r0, r0, r8
    str r0, [r7, #O_HELD]
in_drop:
    mov r0, #1
    pop {r4-r8, pc}
in_release:                     ; the release of a press that was ours is ours
    ldr r0, [r7, #O_HELD]
    tst r0, r8
    beq in_pass
    bic r0, r0, r8
    str r0, [r7, #O_HELD]
    b in_drop
in_pass:
    mov r0, #0
    pop {r4-r8, pc}

; FF at power-on: zero the state once. Clobbers r0 to r3.
ai_init:
    ldr r0, =ST
    ldr r1, [r0, #O_MAGIC]
    ldr r2, =MAGIC
    cmp r1, r2
    bxeq lr
    mov r1, #0
    mov r3, #4
init_word:
    str r1, [r0, r3]
    add r3, r3, #4
    cmp r3, #0x40
    blo init_word
    str r2, [r0, #O_MAGIC]
    bx lr

; ---------------------------------------------------------------- the frame (UI task, from the runtime's shortcut tick)
; r0 the runtime's page lookup (as for ai_input).
ai_tick:
    push {r4-r8, lr}
    mov r6, r0
    ldr r0, =PANEL
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    beq tick_out
    ldr r0, [r0, #0x18]
    tst r0, #KILL
    bne tick_out
    bl ai_init
    ldr r4, =ST
    ldrb r0, [r4, #O_REQ_PANIC]
    cmp r0, #0
    beq tick_toggle
    mov r0, #0
    strb r0, [r4, #O_REQ_PANIC]
    bl ai_unlatch
    mov r5, #0
tick_panic:                     ; All Notes Off on every part, as MIDI CC 123 asks it
    mov r0, r5
    bl NOTES_OFF
    add r5, r5, #1
    cmp r5, #16
    bne tick_panic
tick_toggle:
    ldrb r0, [r4, #O_REQ_TOGGLE]
    cmp r0, #0
    beq tick_watch
    mov r1, #0
    strb r1, [r4, #O_REQ_TOGGLE]
    ldr r1, [r4, #O_LATCH]
    cmp r1, #1
    beq tick_off
    mov r1, r6
    bl ai_latch
    b tick_watch
tick_off:
    bl ai_unlatch
tick_watch:
    ldr r0, [r4, #O_LATCH]
    cmp r0, #1
    bne tick_buffer
    bl PLAYER                   ; another pattern ends it
    ldr r0, [r0, #0x318]
    ldr r1, [r4, #O_PATNO]
    cmp r0, r1
    beq tick_led
    bl ai_unlatch
    b tick_buffer
tick_led:
    mov r0, r6
    bl ai_level_live
    bl ai_led
tick_buffer:
    bl ai_buffer
tick_out:
    pop {r4-r8, pc}

; Latches, r0 the page AUDIO IN PAD (2 or more: stereo), r1 the page lookup: the oscillator and the level, then the refresh the
; SAMPLE encoder's change runs gives part 16 Audio In (ai_kind), then our note. Not the part's sound setup 0xC009B5EC that EXIT +
; pad calls: after it a later note of the part started no voice (no 0x09). Clobbers r0 to r3 and r12.
ai_latch:
    push {r4, lr}
    sub sp, sp, #8
    ldr r4, =ST
    cmp r0, #2
    movhs r0, #AI_OSC_ST
    movlo r0, #AI_OSC_MN
    str r0, [r4, #O_OSC]
    mov r0, r1
    bl ai_level_of
    str r0, [r4, #O_LEVEL]
    bl PLAYER
    ldr r0, [r0, #0x318]
    str r0, [r4, #O_PATNO]
    mov r0, #1
    str r0, [r4, #O_LATCH]
    mov r0, #AI_PART
    bl PART
    bl OSC_REFRESH              ; what the SAMPLE encoder's change runs: the part reads Audio In (ai_kind), its program goes out
    mov r0, #0
    str r0, [sp]
    str r0, [sp, #4]
    mov r0, #AI_PART
    mov r1, #AI_SRC
    mov r2, #AI_NOTE
    mov r3, #AI_VEL
    bl NOTE_ON
    add sp, sp, #8
    pop {r4, pc}

; Ends a latch: our note's note-off, then the part's own sample through the same refresh, and the pad's light. Clobbers r0 to
; r3 and r12.
ai_unlatch:
    push {r4, lr}
    sub sp, sp, #8
    ldr r4, =ST
    ldr r0, [r4, #O_LATCH]
    cmp r0, #1
    bne unlatch_out
    mov r0, #0
    str r0, [sp]
    str r0, [sp, #4]
    mov r0, #AI_PART
    mov r1, #AI_SRC
    mov r2, #AI_NOTE
    mov r3, #0
    bl NOTE_OFF
    mov r0, #0
    str r0, [r4, #O_LATCH]
    mov r0, #AI_PART
    bl PART
    bl OSC_REFRESH              ; the part's own sample again, as a change of the SAMPLE encoder would give it
    ldr r0, =LEDMGR             ; the pad's light, where it is still ours
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    beq unlatch_out
    add r2, r0, #PAD16_RED * 8
    ldrb r1, [r2, #0x4e]
    cmp r1, #LED_ON
    bne unlatch_out
    mov r1, #0
    bl led_put
unlatch_out:
    add sp, sp, #8
    pop {r4, pc}

; r0 the page lookup -> r0 AUDIO IN PEGEL, -1 without the page (or without the lookup). Clobbers r0 to r3 and r12.
ai_level_of:
    cmp r0, #0
    mvneq r0, #0
    bxeq lr
    push {r4, lr}
    mov r12, r0
    ldr r0, =str_level
    blx r12
    cmp r0, #LEVEL_MAX
    mvnhi r0, #0                ; -1 and anything out of range: the oscillator's own default
    pop {r4, pc}

; While latched, r0 the page lookup: a new AUDIO IN PEGEL goes to the voices of part 16 at once, as Korg's OSC EDIT knob sends
; it (part setter 28, 0xC009A59C: every voice of the part takes its oscillator again, ai_osc_edit gives it the level). Clobbers
; r0 to r3 and r12.
ai_level_live:
    push {r4, lr}
    bl ai_level_of
    ldr r4, =ST
    ldr r1, [r4, #O_LEVEL]
    cmp r0, r1
    popeq {r4, pc}
    str r0, [r4, #O_LEVEL]
    mov r0, #AI_PART
    bl PART
    bl OSC_RETAKE
    pop {r4, pc}

; Pad 16 red while latched, in TRIGGER mode, unless a plugin holds the LEDs. Clobbers r0 to r3 and r12.
ai_led:
    ldr r0, =LEDMGR
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    bxeq lr
    ldrb r1, [r0, #0xb98]
    cmp r1, #0
    bxne lr
    ldr r1, [r0, #0xB58]
    cmp r1, #TRIGGER
    bxne lr
    add r2, r0, #PAD16_RED * 8
    ldrb r1, [r2, #0x4e]
    cmp r1, #LED_ON
    bxeq lr
    mov r1, #LED_ON
; r0 the LED manager, r2 its entry of pad 16 red, r1 the value: the firmware's way (both tables, then its send)
led_put:
    push {r4, lr}
    strb r1, [r2, #0x4e]
    add r2, r2, #0x2c0
    strb r1, [r2, #0x4e]
    mov r1, #PAD16_RED
    mov r2, #1
    bl LEDSEND
    pop {r4, pc}

; ---------------------------------------------------------------- the Audio In buffer (UI task)
ai_buffer:
    push {r4-r8, lr}
    sub sp, sp, #8
    ldr r4, =ST
    ldr r0, [r4, #O_PHASE]
    cmp r0, #0
    bne buf_busy
    ldrb r0, [r4, #O_REQ_BUF]
    cmp r0, #0
    beq buf_out
    mov r0, #0
    strb r0, [r4, #O_REQ_BUF]
    bl buf_start
    b buf_out
buf_busy:
    mov r0, #0                  ; asked again while one runs: nothing
    strb r0, [r4, #O_REQ_BUF]
    bl TRANSPORT
    mov r5, r0
    ldr r6, [r5, #0x308]
    ldr r0, =MS
    ldr r0, [r0]
    ldr r1, [r4, #O_T0]
    sub r7, r0, r1              ; ms in this phase
    ldr r0, [r4, #O_PHASE]
    cmp r0, #PHASE_OPEN
    beq buf_open
    cmp r0, #PHASE_REC
    beq buf_rec
    cmp r0, #PHASE_CONFIRM
    beq buf_confirm
; PHASE_WRITE: back on the main screen with the sample: it goes onto the part
    cmp r6, #0
    bne buf_write_wait
    bl MANAGER
    ldr r1, [r0, #0x3fc]        ; the slot the recording went into (the end selects it)
    mov r8, r1
    bl LOADED
    cmp r0, #1
    bne buf_reset
    mov r0, r8
    mov r1, #1
    bl SAMPLE_NEXT              ; only a slot the SAMPLE knob stops on, as korg.seq.setPartValue
    cmp r0, r8
    bne buf_reset
    str r8, [sp]
    mov r0, #1
    str r0, [sp, #4]
    ldr r0, =PART_EDITOR        ; the part edit the SAMPLE knob calls: code 8, the slot, flag 1 (the sound engine follows)
    ldr r0, [r0]
    ldr r1, [r4, #O_PART]
    orr r1, r1, #0x10
    mov r2, #0
    mov r3, #8
    bl PART_EDIT
    b buf_reset
buf_write_wait:
    ldr r0, =WRITE_MS
    cmp r7, r0
    bhs buf_reset
    b buf_out
buf_open:                       ; the window has opened: Audio In, mono, and the recording starts
    cmp r6, #STATE_READY
    bne buf_open_wait
    ldr r0, =SCREENS
    ldr r0, [r0]
    ldr r8, [r0, #0x24]
    cmp r8, #0
    beq buf_open_wait
    ldr r0, [r8]
    ldr r1, =SAMPLING_VT
    cmp r0, r1
    bne buf_open_wait
    mov r0, r8
    mov r1, #0
    bl SET_SOURCE
    mov r0, r8
    mov r1, #0
    bl SET_STEREO
    mov r0, r5
    mov r1, #0
    bl REC_START
    cmp r0, #1
    bne buf_restore
    mov r0, #PHASE_REC
    b buf_phase
buf_open_wait:
    ldr r0, =OPEN_MS
    cmp r7, r0
    bhs buf_restore
    b buf_out
buf_rec:
    cmp r6, #STATE_RECORDING
    bne buf_restore             ; STOP, EXIT or PLAY in the window: the window is the user's again
    ldr r0, [r4, #O_LEN]
    cmp r7, r0
    bhs buf_end
    mov r0, r7
    ldr r1, [r4, #O_LEN]
    bl bar_draw
    b buf_out
buf_end:
    mov r0, #1
    mov r1, #1
    bl bar_draw
    mov r0, r5
    bl REC_END
    mov r0, #PHASE_CONFIRM
    b buf_phase
buf_confirm:                    ; the window shows the new sample: WRITE, as the user would
    cmp r6, #STATE_DONE
    bne buf_confirm_wait
    mov r0, #KEY_WRITE
    mov r1, #1
    bl PANEL_KEY
    mov r0, #KEY_WRITE
    mov r1, #0
    bl PANEL_KEY
    bl src_back
    mov r0, #PHASE_WRITE
    b buf_phase
buf_confirm_wait:
    ldr r0, =CONFIRM_MS
    cmp r7, r0
    bhs buf_restore
    b buf_out
buf_phase:                      ; r0 the next phase, its time starts now
    str r0, [r4, #O_PHASE]
    ldr r0, =MS
    ldr r0, [r0]
    str r0, [r4, #O_T0]
    b buf_out
buf_restore:
    bl src_back
buf_reset:
    mov r0, #0
    str r0, [r4, #O_PHASE]
buf_out:
    add sp, sp, #8
    pop {r4-r8, pc}

; EXIT + REC: refused while playing or recording, while the sample swap is on, and without room (the firmware's "Memory Full");
; else the length (the page's seconds, at most what the DSP has free), the part, the window's source and mono setting are
; noted and the sampling window opens, as SHIFT + REC opens it. Clobbers r0 to r3 and r12.
buf_start:
    push {r4-r6, lr}
    ldr r4, =ST
    bl TRANSPORT
    ldr r0, [r0, #0x308]
    cmp r0, #0
    bne start_out
    ldr r0, =SWAP_MODE          ; FF (never set up) and 0 are off
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    bne start_out
    bl MANAGER
    mov r5, r0
    bl SLOT_FREE
    cmp r0, #0
    beq start_full
    bl DSP_FREE
    ldr r1, =BYTES_PER_S
    bl UDIV
    ldr r1, [r4, #O_SECS]
    cmp r0, r1
    movhi r0, r1
    cmp r0, #0
    beq start_full
    mov r1, #1000
    mul r2, r0, r1
    str r2, [r4, #O_LEN]
    add r1, r5, #0x700
    ldrh r0, [r1, #8]
    str r0, [r4, #O_SRC]
    ldrh r0, [r1, #4]
    str r0, [r4, #O_MODE]
    ldr r0, =LEDMGR
    ldr r0, [r0]
    ldr r0, [r0, #0xB60]
    and r0, r0, #15
    str r0, [r4, #O_PART]
    mov r0, #SAMPLING
    mov r1, #0
    bl OPEN
    mov r0, #PHASE_OPEN
    str r0, [r4, #O_PHASE]
    ldr r0, =MS
    ldr r0, [r0]
    str r0, [r4, #O_T0]
    b start_out
start_full:
    ldr r0, =SCREENS
    ldr r0, [r0]
    cmp r0, #0
    beq start_out
    add r0, r0, #0x10
    mov r1, #ERROR_WINDOW
    mov r2, #ERR_FULL
    bl WINDOW
start_out:
    pop {r4-r6, pc}

; The window's source and mono setting as they were before EXIT + REC. Clobbers r0 to r3.
src_back:
    push {r4, lr}
    bl MANAGER
    add r0, r0, #0x700
    ldr r1, =ST
    ldr r2, [r1, #O_SRC]
    strh r2, [r0, #8]
    ldr r2, [r1, #O_MODE]
    strh r2, [r0, #4]
    pop {r4, pc}

; r0 of r1 done: the bar under "Now Sampling!", filled that far, into the firmware's frame buffer, the region marked changed.
; Clobbers r0 to r3 and r12.
bar_draw:
    push {r4-r6, lr}
    mov r2, #BAR_X1 - BAR_X0 - 2
    mul r0, r2, r0
    bl UDIV
    add r4, r0, #BAR_X0 + 1     ; the first column that is not filled
    ldr r5, =VRAM + BAR_PAGE * 128
    mov r6, #BAR_X0
bar_col:
    ldrb r0, [r5, r6]
    bic r0, r0, #BAR_EDGE
    cmp r6, #BAR_X0
    beq bar_edge
    cmp r6, #BAR_X1 - 1
    beq bar_edge
    cmp r6, r4
    orrlo r0, r0, #BAR_FULL
    orrhs r0, r0, #BAR_OPEN
    b bar_put
bar_edge:
    orr r0, r0, #BAR_EDGE
bar_put:
    strb r0, [r5, r6]
    add r6, r6, #1
    cmp r6, #BAR_X1
    blo bar_col
    mov r0, #BAR_X0
    mov r1, #BAR_PAGE * 8
    mov r2, #BAR_X1
    mov r3, #BAR_PAGE * 8 + 8
    bl MARK
    pop {r4-r6, pc}
.pool

; ---------------------------------------------------------------- the part's sound setup 0xC0099D88 (voice task)
; Replaces ldrh r6, [r3, #8], r0 the part, r3 its record in the sound engine: while latched part 16 reads the latch's Audio In.
ai_kind:
    ldrh r6, [r3, #8]
    ldr r12, =ST
    ldr r12, [r12, #O_LATCH]
    cmp r12, #1
    bxne lr
    ldrb r12, [r0, #0x31]
    cmp r12, #AI_PART
    bxne lr
    ldr r12, =ST
    ldr r6, [r12, #O_OSC]
    bx lr
.pool

; ---------------------------------------------------------------- the end of the part's sound setup (voice task)
; Replaces its tail call b 0xC0091828 (a leaf: lr is the setup's caller), r0 the part: the first two steps of 0xC0091828, then
; back into it. Part +0x28 notes the latch's Audio In for part 16, as after Korg's own change of the oscillator; without it a
; note that takes over a voice of part 16's sample keeps the sample (0xC0091C88). r1 and r12 are free after the setup.
ai_gen:
    ldr r2, [r0, #8]
    ldrh r3, [r2, #8]
    ldr r12, =ST
    ldr r1, [r12, #O_LATCH]
    cmp r1, #1
    bne GEN_BACK
    ldrb r1, [r0, #0x31]
    cmp r1, #AI_PART
    ldreq r3, [r12, #O_OSC]
    b GEN_BACK
.pool

; ---------------------------------------------------------------- a voice takes its oscillator 0xC00998B4 (voice task)
; Replaces ldrb r0, [r3, #0xb], r3 the part's record, r4 the voice, r5 the oscillator's entry in the name table: for Audio In OSC
; EDIT is the input level, and part 16's OSC EDIT belongs to its sample (0 for most: no input). While latched part 16's Audio In
; voice takes AUDIO IN PEGEL, without the page the oscillator's own default (+0x18, 64, what the SAMPLE encoder writes when it
; selects Audio In). r1 (the range) stays; r2 and r3 are loaded anew after the site, so they are free here.
ai_osc_edit:
    ldrb r0, [r3, #0xb]
    ldr r12, =ST
    ldr r2, [r12, #O_LATCH]
    cmp r2, #1
    bxne lr
    ldr r2, [r4, #4]
    ldrb r2, [r2, #0x31]
    cmp r2, #AI_PART
    bxne lr
    ldrh r2, [r4, #0x3a]
    ldr r3, [r12, #O_OSC]
    cmp r2, r3
    bxne lr
    ldr r0, [r12, #O_LEVEL]
    cmp r0, #LEVEL_MAX
    ldrbhi r0, [r5, #0x18]
    bx lr
.pool

str_pad:
    .asciz "AUDIO IN PAD"
str_level:
    .asciz "AUDIO IN PEGEL"
str_buf:
    .asciz "AUDIO IN PUFFER"
str_panic:
    .asciz "PANIC"
"""


def build_code():
    code = arm.assemble(source())
    (at, data), = code.sections
    return at, data, code.symbols


def file_offset(addr):
    return addr - RAM + HEADER


def sha(data):
    return hashlib.sha256(data).hexdigest()


def bl_word(at, target):
    return 0xEB000000 | (((target - (at + 8)) >> 2) & 0xFFFFFF)


def build_patch(vsb):
    at, code, symbols = build_code()
    if at != CODE_AT or at + len(code) > CODE_END:
        raise SystemExit(f"code is {len(code):#x} bytes, room for {CODE_END - CODE_AT:#x}")

    def was(addr, n):
        return vsb[file_offset(addr):file_offset(addr) + n]

    if was(CODE_AT, ST + ST_LEN - CODE_AT) != b"\xff" * (ST + ST_LEN - CODE_AT):
        raise SystemExit(f"{CODE_AT:#x}..{ST + ST_LEN:#x} is not free in this VSB")
    if struct.unpack("<I", was(KIND_SITE, 4))[0] != KIND_WAS:
        raise SystemExit(f"the part's sound setup is not where the patch expects it in this VSB ({KIND_SITE:#x})")
    if struct.unpack("<I", was(GEN_SITE, 4))[0] != GEN_WAS:
        raise SystemExit(f"the tail of the part's sound setup is not where the patch expects it in this VSB ({GEN_SITE:#x})")
    if struct.unpack("<I", was(OSC_EDIT_SITE, 4))[0] != OSC_EDIT_WAS:
        raise SystemExit(f"the voice's oscillator setup is not where the patch expects it in this VSB ({OSC_EDIT_SITE:#x})")
    changes = [{"file": file_offset(CODE_AT), "bytes": code.hex(), "expect": sha(was(CODE_AT, len(code))),
                "note": "audio in: AUDIO IN PAD, PANIC (EXIT + STOP) and the Audio In buffer (EXIT + REC), entries for the runtime"},
               {"file": file_offset(KIND_SITE), "bytes": struct.pack("<I", bl_word(KIND_SITE, symbols["ai_kind"])).hex(),
                "expect": sha(was(KIND_SITE, 4)), "note": "the part's sound setup reads Audio In for part 16 while it is latched"},
               {"file": file_offset(GEN_SITE), "bytes": struct.pack("<I", bl_word(GEN_SITE, symbols["ai_gen"]) & ~0x01000000).hex(),
                "expect": sha(was(GEN_SITE, 4)), "note": "the part's sound setup notes the latch's Audio In as part 16's sound"},
               {"file": file_offset(OSC_EDIT_SITE), "bytes": struct.pack("<I", bl_word(OSC_EDIT_SITE, symbols["ai_osc_edit"])).hex(),
                "expect": sha(was(OSC_EDIT_SITE, 4)),
                "note": "part 16's latched Audio In voice takes AUDIO IN PEGEL as OSC EDIT (its input level)"}]
    hooks = [{"site": f"0x{KIND_SITE:08X}", "kind": "instruction", "chain": "audio-in", "position": "replace", "swallow": False,
              "note": "the part's sound setup reads Audio In for part 16 while it is latched"},
             {"site": f"0x{GEN_SITE:08X}", "kind": "instruction", "chain": "audio-in", "position": "replace", "swallow": False,
              "note": "the part's sound setup notes the latch's Audio In as part 16's sound"},
             {"site": f"0x{OSC_EDIT_SITE:08X}", "kind": "instruction", "chain": "audio-in", "position": "replace", "swallow": False,
              "note": "part 16's latched Audio In voice takes AUDIO IN PEGEL as OSC EDIT (its input level)"}]
    return {
        "format": "gelumpe-patch", "version": 1, "id": "audio-in",
        "name": "Audio In",
        "builds": ["stock"],
        "notNeededOn": ["hacktribe"],   # its places are checked on Korg's build only; a Hacktribe build leaves it out
        "changes": changes,
        "hooks": hooks,
        "startPhase": [{"file": file_offset(KIND_SITE), "length": 4,
                        "why": "the start loads a pattern and sets up each part's sound, which now calls ai_kind"},
                       {"file": file_offset(GEN_SITE), "length": 4,
                        "why": "the same setup ends in the part's sound note, which now goes through ai_gen"},
                       {"file": file_offset(symbols["ai_kind"]), "length": symbols["str_pad"] - symbols["ai_kind"],
                        "why": "ai_kind, ai_gen and their pools run with those calls; they read the latch word (0 or FF there: the "
                               "part's own sample)"}],
        "ram": [ramdecl.area(ST, ST_LEN, "the state of AUDIO IN PAD, PANIC and the Audio In buffer: latch, requests, keys held, "
                             "pattern, phase, time, length, part, the sampling window's source and mono setting, the latch's "
                             "oscillator and level",
                             "tools/patch/audio_in.py:ST")],
    }


def main():
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--vsb", required=True, type=Path)
    p.add_argument("--out", type=Path)
    a = p.parse_args()
    raw = a.vsb.read_bytes()
    if len(raw) != 0x200100:
        raise SystemExit("a VSB has 0x200100 bytes")
    text = json.dumps(build_patch(raw), indent=1) + "\n"
    if a.out:
        a.out.write_text(text)
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()
