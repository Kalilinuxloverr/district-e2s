"""Builds the sample preview patch for the red Sampler 2.02 (Korg's build): PLAY in DATA UTILITY > IMPORT SAMPLE plays the WAV under
the cursor before it is imported.

Nothing is written to the card or the flash and no slot changes. The browser's PLAY (the firmware gives it no meaning there: DATA
UTILITY locks the transport, byte +0x30E) reads the file with the firmware's own parser up to its format checks (the swap's PREP
return at 0xC003621C), converts it to 16-bit mono in the firmware's work buffer and writes it to the DSP above the free pointer
0xC00F9C80, where no sample lies. Then it plays a note on a part, as a pad would; three hooks in the voice setup (0xC0099A40)
hand that one voice the preview's address, end and period instead of the part's sample. The part's sound settings (EG, filter,
insert effect, level, pitch) stay those of the part.

PLAY again starts the preview anew from its beginning, as a pad tap retriggers a part with VOICE ASSIGN MONO, whatever the part's
own voice assign: the note-off of the last strike, then the note-on, which the sound engine takes as Korg's MONO (Mono2): it takes
over the part's voice, cuts it (0x26) and starts it again, the same voice every time (0.3.2 cut the part with All Notes Off and
the note took the next voice each time). The same file is not read again: its audio is still in the DSP, PLAY only strikes the
note anew. Before a file is read, the voices of the part are cut (All Notes Off, the path of MIDI CC 123): none plays audio that
the read overwrites. STOP, the dial, any other key and leaving the browser send the note's note-off; all but STOP also forget
the file, so the next PLAY reads it again (an import moves the free pointer, which makes the next PLAY read it again too).

Which note is the preview's travels with the note: PLAY marks its note-on (the time it was struck), the sound engine takes the
mark with the note-on of the preview's part (0xC00922FC) and the voice setup right after it makes that voice the preview's. Keys
that piled up while a file was read come all at once afterwards; a strike whose note-on the sound engine has not taken yet is
not struck again, and a key that stops or forgets the preview no longer takes its voice away (0.3.2 kept one flag that such keys
cleared before the sound engine got to the note-on, which then played the part's own sample).

Hooks:
  browser vtable 0xC00E3A18  [3] keys PLAY/STOP/SHIFT: PLAY starts the preview anew, another key stops it
                             [6] MENU (ENTER) down, [2] EXIT down, [10] the dial, [0] the destructor: stop
  0xC00922FC  the sound engine takes a note-on: the preview's is MONO (Korg's retrigger on the part's voice)
  0xC0099A48  voice setup entry: the voice of the preview's note-on becomes the preview's (one shot)
  0xC0099B7C  the zone (period) of that voice is ours
  0xC0099BBC  the playback start, loop and end of that voice are ours
With EXIT held at power-on PLAY does what the firmware does (nothing) and no hook changes a voice. Korg's build only: the places
are not checked on Hacktribe, a Hacktribe build of the set leaves the patch out.

    python3 tools/patch/sample_preview.py --vsb SYSTEM.VSB [--out data/patches/sample-preview.json]
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

CODE_AT, CODE_END = 0xC01AD000, 0xC01ADE80      # FF in the image, in the run 0xC01A2100..0xC01FFFF0, no patch of the set uses it
ST, ST_LEN = 0xC01ADE80, 0x40                   # state words, FF at power-on

# state offsets
O_ST, O_VOICE, O_PART, O_PARTNO, O_LOADED, O_ZONE, O_PB, O_GOT, O_SIZE, O_PEND, O_CLAIM = 0, 4, 8, 12, 16, 20, 28, 44, 48, 52, 56
HELD = 1                                        # O_ST: the preview's note is on (no note-off yet)
PEND_MS = 250                                   # O_PEND: a strike's mark (its time | 1) the sound engine takes within ms; older ones lapse

BROWSER_VT = 0xC00E3A18         # class of screen 39, the file browser of IMPORT SAMPLE (measured)
VT_SLOTS = {0: 0xC006A764, 2: 0xC006A1A4, 3: 0xC0060ED4, 6: 0xC006A7AC, 10: 0xC006A394}
ENTER_SITE, ENTER_WAS = 0xC0099A48, 0xE1C033B0  # strh r3, [r0, #48]
ASSIGN_SITE, ASSIGN_WAS = 0xC00922FC, 0xE5D4302E  # ldrb r3, [r4, #0x2e]: the voice assign of the part a note-on is for
ZONE_SITE, ZONE_WAS = 0xC0099B7C, 0xE1D530B6    # ldrh r3, [r5, #6]
PB_SITE, PB_WAS = 0xC0099BBC, 0xE7936207        # ldr r6, [r3, r7, lsl #4]

FIRMWARE = dict(
    SCREENS=0xC03404C0, PANEL=0xC033E6F8, CURSOR=0xC00F9C80, DSP_END=0x1C65EC0,
    GIVER=0xC00369F0, F_OPEN=0xC009DB60, F_READ=0xC009DD74, F_CLOSE=0xC009E3DC, PARSER=0xC0035B10,
    DSP_WRITE=0xC004EF28, NOTE_ON=0xC005AD44, NOTE_OFF=0xC005A20C, NOTES_OFF=0xC00983FC, PART=0xC009AF20, PART_MODE=0xC007ED5C,
    NAMES=0xC047B080, SELECTOR=0xC0348880, UDIV=0xC00021FC, WINDOW=0xC006E9A0, MS=0xC06A292C,
)
KILL = 0x2000
KEY_STOP, KEY_PLAY = 1, 2
NOTE, VELOCITY, NOTE_SOURCE = 60, 100, 0x40         # a pad's note on the part's root key
CAP = 4 * 1024 * 1024                           # file bytes one preview reads at most: about 2 s of card time
DATA = 0x1000                                   # PCM in the work buffer behind the file object and the descriptor
ERR_CARD, ERR_FORMAT, ERR_FULL, ERR_NO_PART = 4, 32, 33, 16   # the firmware's error window: Card Error, Format Error, Memory Full, No Data
# (No Data: no part plays a sample on one voice, or the WAV has no audio)
ERROR_WINDOW = 27


def source():
    names = {**FIRMWARE, "ST": ST, "O_ST": O_ST, "O_VOICE": O_VOICE, "O_PART": O_PART, "O_PARTNO": O_PARTNO,
             "O_LOADED": O_LOADED, "O_ZONE": O_ZONE, "O_PB": O_PB, "O_GOT": O_GOT, "O_SIZE": O_SIZE,
             "O_PEND": O_PEND, "O_CLAIM": O_CLAIM, "HELD": HELD, "PEND_MS": PEND_MS, "KILL": KILL, "KEY_PLAY": KEY_PLAY, "KEY_STOP": KEY_STOP,
             "NOTE": NOTE, "VELOCITY": VELOCITY, "NOTE_SOURCE": NOTE_SOURCE, "CAP": CAP, "DATA": DATA,
             "ERR_CARD": ERR_CARD, "ERR_FORMAT": ERR_FORMAT, "ERR_FULL": ERR_FULL, "ERR_NO_PART": ERR_NO_PART,
             "ERROR_WINDOW": ERROR_WINDOW, "SWAP": sample_swap.STATE, "PREP": sample_swap.OFF["PREP"],
             "P_LEN": sample_swap.OFF["P_LEN"], "P_BITS": sample_swap.OFF["P_BITS"],
             "INSTEP": sample_swap.OFF["INSTEP"], "IMPORT_LOCK": sample_swap.IMPORT_LOCK,
             **{f"VT{i}": target for i, target in VT_SLOTS.items()}}
    return "".join(f".equ {k}, {v:#x}\n" for k, v in names.items()) + f".org {CODE_AT:#x}\n" + sample_swap.halfword(SOURCE)


SOURCE = r"""
; ---------------------------------------------------------------- browser keys (UI task)
; vtable slot 3: r0 the browser, r1 the key, r2 1 down. PLAY starts the preview anew, STOP stops it, another key stops it and
; forgets the file; then the firmware's slot.
pv_key:
    push {r0-r3, r12, lr}
    cmp r2, #1
    bne pk_out
    bl killed
    bne pk_out
    cmp r1, #KEY_PLAY
    bne pk_other
    bl pv_play
    b pk_out
pk_other:
    cmp r1, #KEY_STOP
    bne pk_forget
    bl pv_stop
    b pk_out
pk_forget:
    bl pv_forget
pk_out:
    pop {r0-r3, r12, lr}
    b VT3

; vtable slots 6 (MENU, the browser's ENTER, down), 2 (EXIT down), 10 (the dial) and 0 (the destructor): the preview stops and
; forgets its file, then the firmware's slot. ENTER stops it before the import can write to the DSP.
pv_enter_key:
    push {r0-r3, r12, lr}
    bl pv_forget
    pop {r0-r3, r12, lr}
    b VT6
pv_key2:
    push {r0-r3, r12, lr}
    bl pv_forget
    pop {r0-r3, r12, lr}
    b VT2
pv_dial:
    push {r0-r3, r12, lr}
    bl pv_forget
    pop {r0-r3, r12, lr}
    b VT10
pv_gone:
    push {r0-r3, r12, lr}
    bl pv_forget
    pop {r0-r3, r12, lr}
    b VT0

; ne when EXIT was held at power-on; r12 and the flags change
killed:
    ldr r12, =PANEL
    ldr r12, [r12]
    cmp r12, #0
    bxeq lr
    ldr r12, [r12, #0x18]
    tst r12, #KILL
    bx lr

; The note-off of the preview's note, as a pad tap's release.
pv_stop:
    push {r4, lr}
    sub sp, sp, #8
    ldr r4, =ST
    ldr r0, [r4, #O_ST]
    cmp r0, #HELD
    bne ps_out
    mov r0, #0
    str r0, [r4, #O_ST]
    str r0, [sp]
    str r0, [sp, #4]
    ldr r0, [r4, #O_PARTNO]
    mov r1, #NOTE_SOURCE
    mov r2, #NOTE
    mov r3, #0
    bl NOTE_OFF
ps_out:
    add sp, sp, #8
    pop {r4, pc}

; The note-off, and the next PLAY reads the file again.
pv_forget:
    push {r4, lr}
    bl pv_stop
    ldr r4, =ST
    mov r0, #0
    str r0, [r4, #O_LOADED]
    pop {r4, pc}

; r0 = the browser. The preview starts from its beginning as a pad tap retriggers a MONO part: the note-off of the last strike,
; then the note-on (pv_assign makes it MONO): the file in the DSP again, or the file under the cursor, read first. A strike the
; sound engine has not taken yet (keys that piled up while a file was read) is not struck again.
pv_play:
    push {r4-r11, lr}
    sub sp, sp, #12
    mov r4, r0
    ldr r11, =ST
    ldr r0, [r11, #O_PEND]
    cmp r0, #0
    beq pv_which
    ldr r1, =MS
    ldr r1, [r1]
    orr r1, r1, #1              ; as the mark is made: never below it
    sub r1, r1, r0
    cmp r1, #PEND_MS
    blo tg_out
pv_which:
    bl pv_stop
    ldr r0, [r11, #O_LOADED]
    cmp r0, #1
    bne tg_start
    ldr r0, =CURSOR             ; an import moved the free pointer: the audio may be gone, read the file again
    ldr r0, [r0]
    add r0, r0, #31
    bic r0, r0, #31
    ldr r1, [r11, #O_PB]
    cmp r0, r1
    beq tg_note
tg_start:
    mov r0, #0
    str r0, [r11, #O_LOADED]
    ldr r0, [r11, #O_PARTNO]    ; the voices of the last preview are cut before its audio is overwritten (FF before the first)
    cmp r0, #16
    bllo NOTES_OFF
    ldr r0, =SWAP + INSTEP      ; the swap's step or a card import may not be at the card now
    ldr r0, [r0]
    cmp r0, #1
    beq tg_out
    ldr r0, =IMPORT_LOCK
    ldr r0, [r0]
    cmp r0, #0
    cmnne r0, #1
    bne tg_out
    ldr r5, [r4, #0x20]         ; the directory: +0x308 its entries, +0x318 its path
    ldr r6, [r4, #0x24]         ; the list: +0x35C the first line shown, +0x360 the cursor in it
    ldr r7, [r6, #0x35c]
    ldr r0, [r6, #0x360]
    add r7, r7, r0
    ldr r0, [r5, #0x308]
    ldr r1, [r5, #0x30c]
    sub r1, r1, r0
    cmp r7, r1, lsr #2
    bhs tg_out
    ldr r0, [r0, r7, lsl #2]
    ldrb r0, [r0, #4]           ; the entry's kind: 0 a folder, 1 a file, 2 Upper Folder (measured)
    cmp r0, #1
    bne tg_out
    bl pick_part
    cmn r0, #1
    moveq r0, #ERR_NO_PART
    beq tg_error
    str r0, [r11, #O_PARTNO]
    mov r0, r5                  ; the directory builds "SD:/dir/name" for the cursor, as ENTER does
    mov r1, r7
    ldr r2, [r5]
    ldr r2, [r2, #0x3c]
    blx r2
    mov r7, r0
    add r0, r11, #O_SIZE
    bl GIVER                    ; the firmware's work buffer: file object, descriptor, then the audio
    mov r9, r0
    mov r0, r9
    mov r1, r7
    mov r2, #1
    bl F_OPEN
    cmp r0, #0
    movne r0, #ERR_CARD
    bne tg_error
    ldr r10, =SWAP
    mov r0, #1
    str r0, [r10, #PREP]
    mov r0, r9
    add r1, r9, #0x400
    mov r2, #0
    mov r3, #0
    bl PARSER                   ; up to the format checks: lengths, bits, channels, period; the file stands at the audio
    mov r1, #0
    str r1, [r10, #PREP]
    cmp r0, #0x7e
    beq tg_parsed
    cmp r0, #ERR_CARD
    movne r0, #ERR_FORMAT
    b tg_close_error
tg_parsed:
    add r6, r9, #0x400
    ldrb r8, [r6, #0x41]        ; stereo
    cmp r8, #0
    movne r8, #1
    ldr r0, [r10, #P_LEN]       ; 16-bit bytes in the DSP, both channels
    add r1, r8, #1
    mov r5, r0, lsr r1          ; frames
    ldr r0, [r10, #P_BITS]
    cmp r0, #24
    moveq r10, #3
    movne r10, #2
    mov r10, r10, lsl r8        ; file bytes per frame
    ldr r0, =CURSOR
    ldr r0, [r0]
    add r0, r0, #31
    bic r0, r0, #31             ; the first free DSP byte, 32-byte aligned
    str r0, [r11, #O_PB]
    cmp r5, #0
    moveq r0, #ERR_NO_PART      ; a WAV without audio: No Data
    beq tg_close_error
    ldr r1, =DSP_END
    subs r1, r1, r0
    movlo r1, #0
    cmp r1, #32                 ; no room above the free pointer: Memory Full
    movlo r0, #ERR_FULL
    blo tg_close_error
    cmp r5, r1, lsr #1
    movhi r5, r1, lsr #1        ; a longer file plays its beginning
    ldr r0, =CAP
    mov r1, r10
    bl UDIV
    cmp r5, r0
    movhi r5, r0
    mul r7, r5, r10
    mov r0, r9
    add r1, r9, #DATA
    mov r2, r7
    add r3, r11, #O_GOT
    bl F_READ
    cmp r0, #0
    bne tg_read_error
    ldr r0, [r11, #O_GOT]
    cmp r0, r7
    bne tg_read_error
    mov r0, r9
    bl F_CLOSE
    cmp r0, #0
    movne r0, #ERR_CARD
    bne tg_error
    cmp r10, #2                 ; 16-bit mono stays as it is
    beq tg_send
    add r0, r9, #DATA           ; in place to 16-bit mono: the upper 16 bits of 24, the mean of two channels
    mov r1, r0
    mov r2, r5
cv_frame:
    cmp r10, #4
    bhs cv_wide
    cmp r10, #3
    beq cv_24
cv_16:
    ldrh r3, [r0]
    mov r3, r3, lsl #16
    mov r3, r3, asr #16
    b cv_store
cv_wide:
    cmp r10, #4
    bne cv_24s
    ldrh r3, [r0]
    mov r3, r3, lsl #16
    mov r3, r3, asr #16
    ldrh r12, [r0, #2]
    mov r12, r12, lsl #16
    add r3, r3, r12, asr #16
    mov r3, r3, asr #1
    b cv_store
cv_24:
    ldrb r3, [r0, #1]
    ldrb r12, [r0, #2]
    orr r3, r3, r12, lsl #8
    b cv_store
cv_24s:
    ldrb r3, [r0, #1]
    ldrb r12, [r0, #2]
    orr r3, r3, r12, lsl #8
    mov r3, r3, lsl #16
    mov r3, r3, asr #16
    ldrb r12, [r0, #4]
    ldrb lr, [r0, #5]
    orr r12, r12, lr, lsl #8
    mov r12, r12, lsl #16
    add r3, r3, r12, asr #16
    mov r3, r3, asr #1
cv_store:
    strh r3, [r1]
    add r1, r1, #2
    add r0, r0, r10
    subs r2, r2, #1
    bne cv_frame
tg_send:
    ldr r6, [r11, #O_PB]        ; DSP address
    add r7, r9, #DATA
    mov r8, r5, lsl #1          ; bytes left
tx_chunk:
    cmp r8, #0x10000
    movhs r10, #0x8000
    movlo r10, r8, lsr #1       ; 16-bit words, 64 KiB at most, as the firmware's import
    mov r0, r7
    mov r1, r6
    mov r2, r10
    bl DSP_WRITE
    add r7, r7, r10, lsl #1
    add r6, r6, r10, lsl #1
    subs r8, r8, r10, lsl #1
    bhi tx_chunk
    add r6, r9, #0x400
    mov r0, #0x7f               ; the zone: velocity limit, row 0, period, tune word as the descriptor has them
    str r0, [r11, #O_ZONE]
    ldrh r0, [r6, #0x22]
    strh r0, [r11, #24]
    ldrh r0, [r6, #0x24]
    strh r0, [r11, #26]
    sub r0, r5, #1
    mov r0, r0, lsl #1          ; the last frame: loop and end of a one shot
    str r0, [r11, #O_PB + 4]
    str r0, [r11, #O_PB + 8]
    mov r0, #0
    str r0, [r11, #O_PB + 12]
    ldr r0, [r11, #O_PARTNO]
    bl PART
    str r0, [r11, #O_PART]
    mov r0, #1
    str r0, [r11, #O_LOADED]
tg_note:
    ldr r0, =MS                 ; the mark of this strike: the sound engine takes it with the note-on (pv_assign)
    ldr r0, [r0]
    orr r0, r0, #1
    str r0, [r11, #O_PEND]
    mov r0, #HELD
    str r0, [r11, #O_ST]
    mov r0, #0
    str r0, [sp]
    str r0, [sp, #4]
    ldr r0, [r11, #O_PARTNO]
    mov r1, #NOTE_SOURCE
    mov r2, #NOTE
    mov r3, #VELOCITY
    bl NOTE_ON
    b tg_out
tg_read_error:
    mov r0, #ERR_CARD
tg_close_error:
    mov r4, r0
    mov r0, r9
    bl F_CLOSE
    mov r0, r4
tg_error:
    bl show_error
tg_out:
    add sp, sp, #12
    pop {r4-r11, pc}

; r0 = code: the firmware's error window with its text for the code.
show_error:
    push {r4, lr}
    mov r2, r0
    ldr r0, =SCREENS
    ldr r0, [r0]
    cmp r0, #0
    popeq {r4, pc}
    add r0, r0, #0x10
    mov r1, #ERROR_WINDOW
    bl WINDOW
    pop {r4, pc}

; The part the preview plays through: the selected one, else the next that holds a sample on one voice. r0 = part or -1.
pick_part:
    push {r4-r6, lr}
    ldr r0, =SELECTOR
    ldr r0, [r0]
    ldr r4, [r0, #0x14]
    and r4, r4, #15
    mov r5, #16
pp_part:
    mov r0, r4
    bl PART
    ldrh r1, [r0, #0x34]        ; the sample it plays
    ldr r2, =999
    cmp r1, r2
    bhs pp_next
    ldr r2, =NAMES
    add r2, r2, r1, lsl #5
    ldrh r2, [r2, #30]          ; import number: below 50 an oscillator, no sample
    cmp r2, #50
    blo pp_next
    mov r0, #0
    mov r1, r4
    bl PART_MODE                ; 1: a stereo pair on two voices
    cmp r0, #1
    beq pp_next
    mov r0, r4
    pop {r4-r6, pc}
pp_next:
    add r4, r4, #1
    and r4, r4, #15
    subs r5, r5, #1
    bne pp_part
    mvn r0, #0
    pop {r4-r6, pc}
.pool

; ---------------------------------------------------------------- a note-on in the sound engine 0xC00922FC (voice task)
; Replaces ldrb r3, [r4, #0x2e] (the part's voice assign: bit 1 POLY, bit 0 no legato), r4 the part. The note-on of a strike
; (marked less than PEND_MS ago, on the preview's part) takes the mark and plays as Korg's MONO (Mono2): it takes over the part's
; voice, cut (0x26) and started again as a MONO part's pad retriggers. On a POLY part Korg's list of held mono notes is emptied
; first: the note is a first note, no legato, no return to an older one. The voice setup right after it is the preview's.
pv_assign:
    ldr r12, =ST
    mov r0, #0
    str r0, [r12, #O_CLAIM]
    ldrb r3, [r4, #0x2e]
    ldr r0, [r12, #O_PEND]
    cmp r0, #0
    bxeq lr
    ldr r1, [r12, #O_PART]
    cmp r1, r4
    bxne lr
    mov r1, #0
    str r1, [r12, #O_PEND]
    ldr r1, =MS
    ldr r1, [r1]
    orr r1, r1, #1              ; as the mark is made: never below it
    sub r1, r1, r0
    cmp r1, #PEND_MS
    bxhs lr                     ; a mark whose note-on never came: it lapses, this note is not the preview's
    mov r1, #1
    str r1, [r12, #O_CLAIM]
    tst r3, #2
    bxeq lr                     ; a MONO part: Korg's own
    mov r3, #0
    strh r3, [r4, #252]
    strh r3, [r4, #254]
    add r1, r4, #256
    strh r3, [r1]
    strh r3, [r1, #2]
    strh r3, [r1, #4]
    strh r3, [r1, #6]
    mov r3, #1
    bx lr

; ---------------------------------------------------------------- voice setup 0xC0099A40 (voice task)
; Replaces strh r3, [r0, #48] at its entry, r0 the voice. A new note on the preview's old voice is no longer the preview's; the
; voice of the note-on pv_assign took the mark for becomes it: one shot.
pv_enter:
    strh r3, [r0, #48]
    ldr r12, =ST
    ldr r1, [r12, #O_VOICE]
    cmp r1, r0
    moveq r1, #0
    streq r1, [r12, #O_VOICE]
    ldr r1, [r12, #O_CLAIM]
    cmp r1, #1
    bxne lr
    mov r1, #0
    str r1, [r12, #O_CLAIM]
    ldr r1, [r0, #4]
    ldr r2, [r12, #O_PART]
    cmp r1, r2
    bxne lr
    ldrh r1, [r0, #0x40]
    cmp r1, #50
    bxlo lr
    str r0, [r12, #O_VOICE]
    mov r1, #0
    strb r1, [r0, #0x43]
    mov r1, #1
    strb r1, [r0, #0x42]
    bx lr

; Replaces ldrh r3, [r5, #6] after the zone search, r4 the voice, r5 the zone: the preview's voice takes our zone.
pv_zone:
    ldr r12, =ST
    ldr r3, [r12, #O_VOICE]
    cmp r3, r4
    addeq r5, r12, #O_ZONE
    ldrh r3, [r5, #6]
    bx lr

; Replaces ldr r6, [r3, r7, lsl #4], r2 the playback row: the preview's voice takes our start, loop and end.
pv_pb:
    ldr r6, [r3, r7, lsl #4]
    ldr r12, =ST
    push {r0}
    ldr r0, [r12, #O_VOICE]
    cmp r0, r4
    addeq r2, r12, #O_PB
    ldreq r6, [r2]
    pop {r0}
    bx lr
.pool
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

    def word(addr):
        return struct.unpack("<I", was(addr, 4))[0]

    if was(CODE_AT, CODE_END - CODE_AT + ST_LEN) != b"\xff" * (CODE_END - CODE_AT + ST_LEN):
        raise SystemExit(f"{CODE_AT:#x}..{ST + ST_LEN:#x} is not free in this VSB")
    for slot, target in VT_SLOTS.items():
        if word(BROWSER_VT + 4 * slot) != target:
            raise SystemExit(f"the IMPORT SAMPLE browser's vtable slot {slot} is not {target:#x} in this VSB")
    for site, expect in ((ASSIGN_SITE, ASSIGN_WAS), (ENTER_SITE, ENTER_WAS), (ZONE_SITE, ZONE_WAS), (PB_SITE, PB_WAS)):
        if word(site) != expect:
            raise SystemExit(f"the voice setup is not where the patch expects it in this VSB ({site:#x})")
    changes = [{"file": file_offset(CODE_AT), "bytes": code.hex(), "expect": sha(was(CODE_AT, len(code))),
                "note": "sample preview: PLAY in the IMPORT SAMPLE browser plays the WAV under the cursor"}]
    slot_hooks = ((0, "pv_gone", "the browser's destructor stops the preview"),
                  (2, "pv_key2", "EXIT in the browser stops the preview"),
                  (6, "pv_enter_key", "MENU (ENTER) in the browser stops the preview before the import"),
                  (3, "pv_key", "PLAY in the browser starts the preview anew (mono, the file read once), another key stops it"),
                  (10, "pv_dial", "the dial in the browser stops the preview"))
    for slot, name, note in slot_hooks:
        site = BROWSER_VT + 4 * slot
        changes.append({"file": file_offset(site), "bytes": struct.pack("<I", symbols[name]).hex(), "expect": sha(was(site, 4)),
                        "note": note})
    voice_hooks = ((ASSIGN_SITE, "pv_assign", "the preview's note-on plays as Korg's MONO voice assign: the part's voice retriggers"),
                   (ENTER_SITE, "pv_enter", "the voice setup gives the preview's note-on a one-shot voice"),
                   (ZONE_SITE, "pv_zone", "the preview's voice takes the preview's period"),
                   (PB_SITE, "pv_pb", "the preview's voice takes the preview's DSP address, loop and end"))
    for site, name, note in voice_hooks:
        changes.append({"file": file_offset(site), "bytes": struct.pack("<I", bl_word(site, symbols[name])).hex(),
                        "expect": sha(was(site, 4)), "note": note})
    hooks = [{"site": f"0x{BROWSER_VT + 4 * slot:08X}", "kind": "vtable-slot", "chain": "sample-preview", "position": "before",
              "swallow": False, "note": note} for slot, _, note in slot_hooks]
    hooks += [{"site": f"0x{site:08X}", "kind": "instruction", "chain": "sample-preview", "position": "replace",
               "swallow": False, "note": note} for site, _, note in voice_hooks]
    return {
        "format": "gelumpe-patch", "version": 1, "id": "sample-preview",
        "name": "Sample-Vorschau",
        "builds": ["stock"],
        "notNeededOn": ["hacktribe"],   # its places are checked on Korg's build only; a Hacktribe build leaves it out
        "changes": changes,
        "hooks": hooks,
        "ram": [ramdecl.area(ST, ST_LEN, "the preview's state: its note on, its voice and part, whether its file is in the DSP, "
                             "its zone and playback row, the mark of a strike the sound engine has not taken yet",
                             "tools/patch/sample_preview.py:ST")],
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
