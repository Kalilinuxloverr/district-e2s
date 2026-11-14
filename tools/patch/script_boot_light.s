; ---- the backlight colour at power-on (docs/messungen/2026-10-29-hintergrundlicht-beim-start.md)
; The pins the colour lights (M_BL_ON) are kept in Global byte 250 (BOOT_SLOT, the numbering of bytes 247 and 248; in the flash it is byte 246 of the block): 0x80 plus the pins, 0 (or any other
; value) is the stock white. The firmware saves the Globals itself (switch-off, WRITE on Global); BLECH only sets the byte in RAM, when
; the settings are read and when they are written. A colour between the levels needs the PWM of the armed menu: until then each channel
; is on or off (on if it is at least half of the strongest, see boot_light_save).
.equ BOOT_SLOT, 250             ; *GLOBALS_PTR + 250 is byte 246 of the block in the flash (the object has a word in front)
.equ BOOT_FLASH, 0x2300F4       ; Global bytes 244 to 255 in the flash, the last word is the mark GLED
.equ BOOT_GLED, 0x44454C47

; Sets the three pins of the colour the Globals in the flash keep, from the start hook of the build (FLASH_GET, FLASH_READ are
; its own). With EXIT held, a panel update or no valid Globals in the flash nothing happens. Keeps every register.
boot_light_set:
    push {r0-r5, r12, lr}
    sub sp, sp, #16
    ldr r4, =PANEL
    ldr r4, [r4]
    cmp r4, #0
    beq boot_light_out
    cmn r4, #1
    beq boot_light_out
    ldr r1, [r4, #0x18]
    tst r1, #KILL_MASK
    bne boot_light_out
    ldrb r1, [r4, #0x22]
    cmp r1, #0
    bne boot_light_out
    bl FLASH_GET
    mov r1, sp
    ldr r2, =BOOT_FLASH
    mov r3, #12
    bl FLASH_READ
    ldr r0, [sp, #8]
    ldr r1, =BOOT_GLED
    cmp r0, r1
    bne boot_light_out
    ldrb r0, [sp, #2]
    and r1, r0, #0xC7
    cmp r1, #0x80
    bne boot_light_out
    ldr r1, =BL_DIM_FLAG
    ldrb r1, [r1]
    cmp r1, #0
    bne boot_light_out
    and r4, r0, #0x38
    ldr r0, =GPIO_BASE
    mov r1, #0
    mov r2, #3
    eor r3, r4, #0x38
    bl GPIO_WRITE
    ldr r0, =GPIO_BASE
    mov r1, #1
    mov r2, #3
    mov r3, r4
    bl GPIO_WRITE
boot_light_out:
    add sp, sp, #16
    pop {r0-r5, r12, lr}
    bx lr

; The firmware's light calls before the menu is armed (about 143 and 304 ms, bl_set_red and the others): a channel the boot colour
; keeps dark stays off. r1 = 1 on, r2 = the channel's pin -> r1; clobbers r3, r12.
boot_light_keep:
    cmp r1, #0
    bxeq lr
    ldr r3, =BL_DIM_FLAG
    ldrb r3, [r3]
    cmp r3, #0
    bxne lr
    ldr r3, =PANEL
    ldr r3, [r3]
    cmp r3, #0
    bxeq lr
    cmn r3, #1
    bxeq lr
    ldr r12, [r3, #0x18]
    tst r12, #KILL_MASK
    bxne lr
    ldrb r12, [r3, #0x22]
    cmp r12, #0
    bxne lr
    ldr r3, =GLOBALS_PTR
    ldr r3, [r3]
    cmp r3, #0
    bxeq lr
    ldrb r3, [r3, #BOOT_SLOT]
    and r12, r3, #0xC7
    cmp r12, #0x80
    bxne lr
    tst r3, r2
    moveq r1, #0
    bx lr
bl_red_boot:
    push {lr}
    mov r2, #0x08
    bl boot_light_keep
    pop {lr}
    b bl_red_go
bl_green_boot:
    push {lr}
    mov r2, #0x10
    bl boot_light_keep
    pop {lr}
    b bl_green_go
bl_blue_boot:
    push {lr}
    mov r2, #0x20
    bl boot_light_keep
    pop {lr}
    b bl_blue_go

; The menu is armed without a settings file: a colour the start set goes back to the stock white (the menu's M_BL_ON is 0x38).
boot_light_settle:
    ldr r1, =GLOBALS_PTR
    ldr r1, [r1]
    cmp r1, #0
    bxeq lr
    ldrb r0, [r1, #BOOT_SLOT]
    and r1, r0, #0xC7
    cmp r1, #0x80
    bxne lr
    cmp r0, #0xB8
    bxeq lr
    b menu_backlight_now

; r0 = the pins the backlight colour lights (M_BL_ON), r4 = the menu state: into Global byte 250. The start can only switch a pin on or off,
; so a channel is kept only if its level is at least half of the strongest one (2 * level >= the maximum): HUE 15 SAT 13 BRIGHT 14 is
; 14, 13, 2 and starts as red and green (yellow), not as white. The strongest channel stays on, a colour that is lit never starts dark.
; Clobbers r0 to r3, r12.
boot_light_save:
    ldr r1, =GLOBALS_PTR
    ldr r1, [r1]
    cmp r1, #0
    bxeq lr
    and r0, r0, #0x38
    ldr r2, [r4, #M_BL_R]
    ldr r3, [r4, #M_BL_G]
    ldr r12, [r4, #M_BL_B]
    push {r5}
    mov r5, r2
    cmp r3, r5
    movhi r5, r3
    cmp r12, r5
    movhi r5, r12
    cmp r5, #0                  ; 0 0 0 is the stock white: all three
    beq boot_light_save_go
    cmp r5, r2, lsl #1
    bichi r0, r0, #0x08
    cmp r5, r3, lsl #1
    bichi r0, r0, #0x10
    cmp r5, r12, lsl #1
    bichi r0, r0, #0x20
boot_light_save_go:
    pop {r5}
    orr r0, r0, #0x80
    strb r0, [r1, #BOOT_SLOT]
    bx lr
.pool
; ---- the display light while the samples load: round the colour wheel, a step a frame (40 ms, a round in 3.84 s). Called by the
; frame hook in every frame. The patch of the loading picture says when: its state word LOAD_STATE is 1 while its overlay draws,
; from the start of the loader to the main screen (not while the start image has its time, not without a sample file, not with
; EXIT held). After that the light goes back to the colour of the settings once, unless a plugin has set its own meanwhile.
; The levels go the way of korg.backlightLevel (LK_BL of script_hw.s), so the PWM of the armed menu shows them; nothing happens
; before the menu is armed. Clobbers r0 to r3 and r12.
.equ BC_LAST, 0                 ; BOOT_CYCLE: the word this wrote to LK_BL last, 1 in its top byte; any other top byte (FF at power-on): not on its round
.equ BC_PHASE, 4                ; the place on the wheel, 0 to 95: 16 steps from each of red, yellow, green, cyan, blue, pink to the next
boot_light_cycle:
    mov r0, #BOOT_CYCLE_ON
    cmp r0, #0
    bxeq lr
    ldr r0, =MENU_STATE
    ldr r0, [r0, #M_ON]
    cmp r0, #1
    bxne lr
    ldr r3, =BOOT_CYCLE
    ldr r2, =LOOK_HOLD
    ldr r0, =LOAD_STATE
    ldr r0, [r0]
    cmp r0, #1
    beq boot_cycle_step
    ldr r0, [r3, #BC_LAST]      ; the load is over (or never began): back to the settings, if the light is still what this set
    mov r1, r0, lsr #24
    cmp r1, #1
    bxne lr
    mvn r1, #0
    str r1, [r3, #BC_LAST]
    ldr r12, [r2, #LK_BL]
    cmp r12, r0
    bxne lr
    str r1, [r2, #LK_BL]
    b boot_cycle_show
boot_cycle_step:
    ldr r0, [r3, #BC_LAST]
    ldr r1, [r3, #BC_PHASE]
    mov r0, r0, lsr #24
    cmp r0, #1
    mvnne r1, #0                ; the round starts at red
    add r1, r1, #1
    cmp r1, #96
    movhs r1, #0
    str r1, [r3, #BC_PHASE]
    push {r4, r5, lr}
    mov r4, r1, lsr #4          ; the sixth of the wheel,
    and r1, r1, #15             ; the level that rises in it
    rsb r12, r1, #15            ; and the one that falls
    mov r0, r4
    bl boot_cycle_level
    mov r5, r0                  ; red; green is a third of the wheel behind it, blue two thirds
    add r0, r4, #4
    bl boot_cycle_level
    orr r5, r5, r0, lsl #8
    add r0, r4, #2
    bl boot_cycle_level
    orr r5, r5, r0, lsl #16
    orr r5, r5, #0x01000000
    ldr r3, =BOOT_CYCLE
    str r5, [r3, #BC_LAST]
    ldr r2, =LOOK_HOLD
    str r5, [r2, #LK_BL]
    pop {r4, r5, lr}
boot_cycle_show:                ; as korg.backlightLevel: the tables with the interrupts off (the PWM reads them in the timer
    push {r4, lr}               ; interrupt), the pins at once where no PWM runs
    .word 0xE10F4000 ; mrs r4, cpsr
    orr r1, r4, #0xC0
    .word 0xE121F001 ; msr cpsr_c, r1
    bl look_tables
    .word 0xE121F004 ; msr cpsr_c, r4
    ldr r0, =MENU_STATE
    ldr r0, [r0, #M_BL_PWM]
    cmp r0, #0
    bleq menu_backlight_now
    pop {r4, pc}
; r0 = a sixth of the wheel (0 to 7, taken round), r1 = the rising level, r12 = the falling one -> r0 = red's level there:
; full, falling, off, off, rising, full. Keeps r1 to r3 and r12.
boot_cycle_level:
    cmp r0, #6
    subhs r0, r0, #6
    cmp r0, #1
    moveq r0, r12
    bxeq lr
    movlo r0, #15
    bxlo lr
    cmp r0, #4
    movlo r0, #0
    bxlo lr
    moveq r0, r1
    movhi r0, #15
    bx lr
.pool
boot_light_end:
