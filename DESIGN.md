---
name: Meuss Padel Club
description: A browser 2v2 padel match dressed as a pro-tour TV feed, with a night arena and flat navy broadcast graphics.
colors:
  bug-navy: "#0f1a33"
  bug-navy-2: "#16244a"
  navy-lift: "#172649"
  bug-white: "#f4f7ff"
  bug-ink: "#0b1020"
  azul: "#62b0ff"
  rojo: "#d8383a"
  optic: "#e4f23a"
  turf: "#2c7cc6"
  surround: "#184a82"
  steel: "#0d1016"
  mesh: "#2a313c"
  glass-tint: "#9fc4dc"
  sky: "#05070d"
  led-background: "#0b1a3a"
  timing-perfect: "#7bd13a"
  timing-off: "#f5a524"
typography:
  display:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "max(88px, 8.7 * min(1vw, 1.7778vh))"
    fontWeight: 700
    lineHeight: 0.86
    letterSpacing: "0"
  headline:
    fontFamily: "Barlow Semi Condensed, Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "9.3vh"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  title:
    fontFamily: "Barlow Semi Condensed, Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(17px, 2.9vh, 44px)"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
    fontFeature: "\"tnum\""
  body:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(18px, 1.35vw, 30px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
  label:
    fontFamily: "Barlow Condensed, Arial Narrow, sans-serif"
    fontSize: "clamp(13px, 0.95vw, 20px)"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "0.06em"
rounded:
  plate: "2px"
  join: "4px"
spacing:
  hud-inset: "clamp(12px, 1.6vh, 28px)"
  lower-third-x: "4.9vw"
  lower-third-y: "4.6vh"
  rule: "max(3px, 0.6vh)"
components:
  button-primary:
    backgroundColor: "{colors.bug-navy}"
    textColor: "{colors.bug-white}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0.45em 0.9em"
  button-ghost:
    backgroundColor: "rgba(11, 16, 32, 0.35)"
    textColor: "{colors.bug-white}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0.45em 0.9em"
  button-ghost-hover:
    backgroundColor: "{colors.bug-navy}"
  button-play:
    backgroundColor: "{colors.optic}"
    textColor: "{colors.bug-ink}"
    rounded: "{rounded.join}"
    height: "max(56px, 4.65 * min(1vw, 1.7778vh))"
  button-play-hover:
    backgroundColor: "#edf86b"
  input-nickname:
    backgroundColor: "rgba(244, 247, 255, 0.14)"
    textColor: "{colors.bug-white}"
    rounded: "{rounded.join}"
    padding: "0 0.55em"
    height: "max(38px, 3.1 * min(1vw, 1.7778vh))"
  score-bug:
    backgroundColor: "{colors.bug-navy}"
    textColor: "{colors.bug-white}"
    typography: "{typography.title}"
    width: "18.2vw"
  score-bug-points:
    backgroundColor: "{colors.bug-white}"
    textColor: "{colors.bug-ink}"
    width: "15%"
  banner:
    backgroundColor: "{colors.bug-navy}"
    textColor: "{colors.bug-white}"
    typography: "{typography.headline}"
    width: "66.7vw"
  nametag:
    backgroundColor: "{colors.bug-navy}"
    textColor: "{colors.bug-white}"
    typography: "{typography.label}"
    padding: "0.3em 0.55em 0.2em"
  replay-tag:
    backgroundColor: "{colors.rojo}"
    textColor: "{colors.bug-white}"
    height: "5.5vh"
---

# Design System: Meuss Padel Club

## Overview

**Creative North Star: "The Night Broadcast"**

The match is a pro-tour television feed of a floodlit night session. The 3D world is a black steel cage on a cerulean court under white floodlight banks, with dark stands falling away to near-black sky. Everything laid over that picture is broadcast graphics, not game menus: flat navy plates, condensed caps, tabular digits, thin coloured rules, and wipes that run left to right the way a vision mixer cuts them in. The rejected alternative is the floating, glassy, rounded game HUD.

Density follows the broadcast's rhythm. During the rally the screen holds only the score bug (bottom-left), the player's own marker, quiet name tags and a dimmed controls legend. Between points the graphics take over: a centred Banner lower third, an instant replay with its REPLAY plate, and at the set's end a centred Final card. Each one dismisses the others; two big graphics never share the screen.

Copy is English broadcast copy set in uppercase condensed caps. The only Spanish words are the team names AZUL and ROJO.

**Key Characteristics:**
- Flat navy plates (#0f1a33) with off-white type, square-shouldered (2px) corners.
- Barlow Condensed for broadcast copy, Barlow Semi Condensed for the large graphic lettering; uppercase, tabular digits throughout.
- Team colour is carried by bars, dots, rules and underlines, never by flooding a panel.
- Optic yellow is the ball's colour and appears in the HUD only as the serve dot, thin accent rules and the single call to action.
- Graphics enter on a left-to-right clip wipe on a long ease-out curve and fall back to a fade under reduced motion.

## Colors

A night-arena palette: deep navy graphics and near-black steel over a saturated cerulean court, with two team colours and one optic accent.

### Primary
- **Broadcast Navy** (bug-navy): the plate colour of every graphic: score bug, Banner, vote panel, Final card, controls card, name tags, emote tray, and the solid side of the join scrim. Also the canvas fill behind fault text in the 3D world.
- **Raised Navy** (bug-navy-2): the second tone inside a plate: the games cell of the score bug, table headers, card footers, and hover/pressed fills.
- **Lit Navy** (navy-lift): the top stop of the vertical gradient that gives body rows and card tops a faint overhead light (navy-lift down to bug-navy, 180deg).

### Secondary
- **Azul Sky** (azul): team Azul. Its bar on the score bug, team dots, name-tag underlines, the Banner's top rule for an Azul GAME or SET, and the winner line on the Final card. Also the `::selection` fill.
- **Rojo Signal** (rojo): team Rojo, with the same roles as Azul. It is also the fault tone: the Banner rule for a fault, the net-fault rings in the world, the REPLAY plate and the disconnected-socket pulse.

### Tertiary
- **Optic Ball** (optic): the ball itself, the serving team's ball icon in the bug, the accent rule over the Banner, vote panel, serve prompt, score call and card footers, the outline of the primary button, the join PLAY slab, the nickname field's focus ring and caret, and the highlighted part of a control glyph.

### Neutral
- **Floodlit White** (bug-white): all text on navy, the points cell of the score bug, and the white header strips on the Final card and controls card. Court lines in the world are this colour too.
- **Broadcast Ink** (bug-ink): text on white or optic surfaces (points cell, header strips, PLAY) and the page background behind the canvas.
- **White at opacity**: hairline rules are white at 0.16 to 0.26 alpha. Panel borders use 0.38 to 0.55, muted text 0.68 to 0.82, and the ghost-button outline 0.3. These are tints of bug-white, not separate colours.

### World
- **Cerulean Turf** (turf) and **Deep Surround** (surround): the court surface and the run-off around it.
- **Cage Steel** (steel) and **Galvanised Mesh** (mesh): the black frame and the slightly lighter wire of the cage.
- **Glass Tint** (glass-tint): the back and side glass.
- **Night Sky** (sky): the void above the stands.
- **LED Navy** (led-background): the perimeter and end boards, with white LED text.
- **Timing Green / Timing Amber** (timing-perfect, timing-off): only the Timing arc and its label. Green means perfect; early and late share amber, and the label tells them apart.

### Named Rules
**The Optic Is The Ball Rule.** Optic yellow belongs to the ball. In the HUD it appears only as a rule, the serve dot, a glyph highlight, a focus ring, or the outline or fill of the one action a screen asks for. It never fills a panel or a block of text.

**The Team Stripe Rule.** Team colour marks a plate from its edge: a 4px bar, a dot, a 2px underline or the top rule. Plates stay navy. When a team wins, its colour moves onto the rule or the winner line, not the card.

**The Tone Rides The Rule Rule.** The top rule of a lower third carries its meaning: optic when neutral, rojo for a fault, the team's colour for its GAME or SET.

## Typography

**Display Font:** Barlow Condensed (with Arial Narrow, sans-serif), weights 500, 600 and 700, loaded from Google Fonts.
**Graphic Font:** Barlow Semi Condensed (with Barlow Condensed), weights 500 and 700. It sets the score bug's header and team names and the Banner.

**Character:** Narrow, tall broadcast caps with no tracking on the big lettering and a little air on small labels. Every number is tabular, so scores never shift when they change.

### Hierarchy
- **Display** (700, max(88px, 8.7ju), line-height 0.86): the stacked three-line MEUSS / PADEL / CLUB wordmark on the join screen. This is the only place the wordmark is drawn as type at this size.
- **Headline** (Semi Condensed 700, 9.3vh, 0.01em): the Banner title (GAME, SET, FAULT). The Banner sub line is 500 at 4.8vh. The Final card score is 13vh at 700.
- **Title** (Semi Condensed 700, clamp(17px, 2.9vh, 44px), tabular): score bug rows. Card and panel titles sit at 3.6 to 6vh, weight 700, tracked 0.05 to 0.08em.
- **Body** (600 to 700, clamp(18px, 1.35vw, 30px), 0.06em): the serve prompt and other single-line broadcast calls.
- **Label** (600, clamp(13px, 0.95vw, 20px), 0.06em, uppercase): name tags, buttons, the watching pill and legend captions. Muted column heads and table labels track wider (0.08 to 0.16em) at 0.72 white.

### Named Rules
**The All-Caps Broadcast Rule.** HUD copy is uppercase condensed caps on a line height of 1. The exceptions are the join screen's helper sentences and the controls card's how-to notes, which are sentence case, Barlow 500 to 600, with a line height of 1.15 to 1.25.

**The Tabular Score Rule.** Any element that shows a score, count or timer sets `font-variant-numeric: tabular-nums`.

## Layout

The HUD is a fixed overlay on a full-bleed WebGL canvas and is built for a desktop 16:9 window. Sizes scale with the viewport through `vh`, `vw` and clamp() so the graphics keep the comp's proportions from 1280×720 to 2560×1440. The join screen uses its own unit, `--ju` = min(1vw, 1.7778vh), which is one comp pixel × 16.

- **Lower-third anchors:** the score bug sits bottom-left and the vote panel, controls legend and TAKE SEAT button sit bottom-right, all inset 4.9vw × 4.6vh. The score bug is 18.2vw wide (min 240px).
- **Centre stage:** the Banner is centred at the bottom (66.7vw wide, 6.8vh up). The serve prompt is centred above it. The Final card (46vw) and controls card (44vw) are centred in the frame.
- **Corners:** the connection pill sits top-left and the watching pill and mute button top-right, at the edge inset (clamp(12px, 1.6vh, 28px)).
- **Join:** the live arena stays sharp on the left. A navy scrim closes in from 46% to fully solid at 69%, and one column on the right holds the wordmark, form, controls glyphs and room line. Below a 5:4 aspect ratio the column centres on a 0.9 navy scrim.
- **Step-aside choreography:** while a Banner, the Final card or the join screen is up, the bug, the serve prompt, the name tags and the legend fade out (180ms). During the rally the legend drops to 0.55 opacity and the name tags hide.

## Elevation & Depth

The system is mostly flat. Plates sit on the 3D picture with one soft, dark ambient shadow so they read over a bright court. There is no blur, no glass and no glow. Inside a plate, depth comes from tone (navy, raised navy, the lit-navy gradient) and hairline rules, not from stacking surfaces.

### Shadow Vocabulary
- **Plate** (`box-shadow: 0 6px 18px rgba(3, 6, 14, 0.5)`): the default for bug-panel plates, the vote panel, the emote tray and the REPLAY plate.
- **Card** (`box-shadow: 0 12px 40px rgba(3, 6, 14, 0.55)`): the two centred cards (Final, controls).
- **Slab** (`box-shadow: 0 6px 18px rgba(3, 6, 14, 0.35)`, deepening on hover, compressing on press): the join PLAY button only.

### Named Rules
**The Flat Plate Rule.** Graphics are opaque navy. A plate is translucent only for a legibility scrim (the join gradient, the dimmed legend plate at 0.74, the score call at 0.92), never for a frosted-glass look.

## Shapes

Graphics are rectangles with square shoulders: a 2px radius on plates and buttons. The Banner and score bug have hard square corners. Inputs and the PLAY slab on the join screen soften to 4px, as in the approved join comp. The REPLAY plate and its key chip use 0.5vh. Circles are kept for team dots, the serve ball and the connection dot.

Rules are the main structural device. Hairlines (1px, or max(1px, 0.07vw) in the bug) divide rows and columns. Accent rules (max(3px, 0.6vh) on top, max(2px, 0.3vh) on footers) carry tone. Entrances are clip-path wipes that expose a rectangle left to right and close it from the left on the way out.

## Components

### Buttons
Buttons are broadcast keys: navy plates with condensed caps, not pills.
- **Shape:** square-shouldered (2px).
- **Primary:** a navy plate with an optic outline (max(1.5px, 0.12vw)), white caps at 700, tracked 0.06em. On hover it takes a 16% optic tint and on press 26%. After a vote is accepted it is disabled with the outline dimmed to 40%.
- **Ghost:** ink at 35% with a 1px white outline at 0.3. On hover it fills to navy and the outline rises to 0.65.
- **Focus:** a 2px bug-white outline offset 2px on every button.
- **PLAY (join only):** a solid optic slab with ink caps (about 13:1 contrast), a 4px radius, the slab shadow, and a 1px press-down.

### Inputs / Fields
- **Style:** the nickname field is white at 14% on navy, with a 1px white outline at 0.34, a 4px radius and Barlow 600 at the label size.
- **Focus:** the outline turns optic and a 1px optic ring is added. The caret is optic.
- **Error:** the message sits on the left of the meta line and the 0/16 counter on the right. The counter turns optic when full.

### Score Bug (signature)
The comp-measured bottom-left plate. A header strip reads MEUSS PADEL CLUB in Semi Condensed 700 and shows a white TIEBREAK chip when it applies. Two team rows follow, each with a 4px team bar, a team dot, the name, the optic serve ball after the serving team's name, a raised-navy games cell and a white points cell. A changed value flashes its cell for 300ms without any scale change. For 2.5s after each point a score call strip with an optic top rule slides out under the bug.

### Banner (signature)
The between-points lower third: a tone rule over a navy title band (10.8vh) and a hairline over a sub band (6.8vh). It wipes in over 220ms and out over 180ms. The score bug steps aside while it is up.

### Final Card
A white header strip (SET & MATCH, tracked 0.12em) with the winner's colour as its top rule. Then the winner line in team colour, the 13vh score, the winners' short names, a stats table with team dots, and a raised-navy footer with an optic rule that holds the REMATCH? vote.

### Name Tags
Small navy plates floating at head height with a 2px team underline, label type, at most 16 characters with an ellipsis. They show between points only.

### Replay Tag
A rojo plate with a white dot and REPLAY in 700 caps, top-right. Under it, for Players only, a darker key chip for skipping.

### Control Glyphs
Keycaps and a mouse drawn as SVG strokes (1.4) in currentColor, with the button to press filled optic. They are used in the join legend, the controls card and the compact legend.

## Do's and Don'ts

### Do:
- **Do** build every new graphic on a flat bug-navy plate with bug-white uppercase Barlow caps, tabular digits and a 2px corner.
- **Do** carry meaning on a rule: a max(3px, 0.6vh) top rule in optic, rojo or a team's colour.
- **Do** bring graphics in with a left-to-right clip-path wipe on cubic-bezier(0.16, 1, 0.3, 1) in 160 to 280ms, and fall back to a plain opacity fade under `prefers-reduced-motion`.
- **Do** make other graphics step aside (opacity 0, 180ms) when a Banner, card or the join screen takes the stage.
- **Do** anchor lower thirds at 4.9vw × 4.6vh from the bottom corners and take sizes from vh or vw so the HUD scales with the frame.
- **Do** keep team colours to AZUL #62b0ff and ROJO #d8383a, matched between hud.css and world/palette.ts.

### Don't:
- **Don't** use frosted glass, backdrop blur, glows or large rounded corners on HUD panels. The system rejects the floating-panel game HUD.
- **Don't** fill a panel, a block of text or a large area with optic. It is the ball's colour.
- **Don't** flood a plate with a team colour. Team identity sits on a bar, dot, underline or rule.
- **Don't** set HUD copy in a system UI face. Broadcast type is Barlow Condensed or Barlow Semi Condensed.
- **Don't** add small tracked labels above titles. A graphic's title is its first line.
- **Don't** scale-bounce a score change. The cell flashes its colour and settles.
