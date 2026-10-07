# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Friends and coworkers who share one link and play together in sessions of about fifteen minutes. Four people play and anyone else who opens the link watches. Desktop only, using keyboard and mouse.

## Product Purpose

Meuss Padel Club is a browser game where two teams of two play padel. It lets a group jump into a real match together with no install and no accounts: open the link, type a nickname and play. Bots fill any empty seats. The game succeeds when a session ends with people asking for another match.

## Positioning

It is a faithful game of padel, not tennis with a new skin. The glass walls and fences around the court are in play, and the rules are real: serves and faults, golden point, tiebreak at 6–6, and ends swapped after odd games. The server runs the match, so every player and spectator sees the same rally.

## Operating Context

- There is one global room. The first four connections play, everyone else spectates, and bots can fill player seats.
- Players react to each other with image emotes. A full reset of the set needs a vote of all players.
- The server runs on a free hosting tier that sleeps when nobody is playing. The first visitor waits 30–60 s on a loading screen while it wakes up.

## Capabilities and Constraints

- Desktop browsers only. Phones and tablets are out of scope for now, for both playing and spectating.
- The game is a Three.js scene with a DOM overlay for the HUD. Players are drawn in code and are not physics bodies; only the ball is simulated. It has to run smoothly on ordinary laptops.
- Controls: WASD or arrow keys to move, the mouse to aim, click to swing, Space to serve.
- Priorities for the next big redesign: how the game looks and how it feels to play (hits, feedback, sound).

## Brand Commitments

- The game is called **Meuss Padel Club**.
- No company branding: the old Marvelous logo is dropped.
- The reaction images in `packages/client/public/reactions/` are existing assets that the emote system depends on.

## Evidence on Hand

There are no player statistics, testimonials or recorded matches. Don't make any up.

## Product Principles

- Getting into a match must take only seconds: link, nickname, play.
- How a hit feels matters more than how many features the game has.
- Everyone, spectators included, should be able to read what is happening in the rally.
- Playing with friends is the whole point: reactions, names and the shared moment matter.
