# Meuss Padel Club

A browser game of 2v2 padel among friends: one shared room, four seats, real padel rules, presented like a pro-tour TV broadcast.

## People

**Player**:
Someone (human or bot) occupying one of the four seats on court.
_Avoid_: User, client

**Spectator**:
Someone connected to the room who does not hold a seat; watches through the Broadcast cam.
_Avoid_: Viewer, observer

**Bot**:
A server-controlled Player filling an empty Seat, at one fixed skill level. Serves with perfect Timing, and holds its toss while a notable Point is being replayed. Bots leave when the last human does.
_Avoid_: AI, CPU

**Seat**:
One of the four player positions, two per Team.
_Avoid_: Spot, place

## Teams

**Azul / Rojo**:
The two Teams, named in Spanish after their kit colours. Always Azul and Rojo in anything a person reads. They are the only Spanish words in the game: all other copy is English broadcast copy.
_Avoid_: Blue/Red, Team A/B

**Side**:
The half of the court a Team currently defends. Teams swap Sides after each odd-numbered Game.
_Avoid_: End, half (in UI copy)

## Scoring

**Rally**:
The exchange of Shots from a serve until the point ends.

**Point / Game / Set / Match**:
Standard padel scoring units; a Match is one Set.

**Golden point**:
The deciding point at 40–40; whichever Team wins it takes the Game. Replaces advantage.
_Avoid_: Deuce, advantage, punto de oro

**Tiebreak**:
The Game played at 6–6 to decide the Set.

**Cage**:
The walls around the court: glass panels and metal mesh (called the fence in copy), at regulation heights. The ball plays off both, but bounces differently off each.

**Serve**:
The Shot that starts a Rally: a toss, then a strike aimed by the serving Player. Its Timing (how close the strike is to the top of the toss) shifts where it lands, so a mistimed Serve can land out of the box. Letting the toss drop is a Fault too.

**Let**:
A Serve that clips the net and lands in the box. It is replayed and does not count as a Fault.

**Fault**:
A Serve or Shot that breaks the rules: a Serve out of the box, into the net or off the Cage first, or a Shot into the net, out, onto the Cage on the full, a double hit, or a double bounce. Two serve Faults in a row (a double fault) lose the Point. Faults always come from what happened on court, never from chance, and each is shown at its true position by a fault animation.

**Rematch vote**:
The vote, opened automatically on the Final card when a Match ends, to start a new Match with the same Seats.

**Reset vote**:
The vote any human Player can start to restart the Match. Every human Player must accept; one decline cancels it.

**Score call**:
The umpire-style reading of the score after each Point, server's score first (e.g. "Thirty–Fifteen", "Fifteen All", "Golden Point"), shown as text under the score bug, never spoken.

## Shots

**Shot**:
One hit of the ball by a Player.
_Avoid_: Swing (a swing that misses is not a Shot)

**Drive**:
A flat, driven Shot; the default stroke.

**Lob**:
A high, deep Shot over the opponents, sent by choice.

**Smash**:
An overhead Shot that happens automatically when the ball is high above the Player at contact.

**Timing**:
How well a Shot is struck: early, perfect, or late. Changes the Shot's power and accuracy, and is shown by the Timing arc under the hitter.

## Presentation

**Player cam**:
A Player's view from behind their own Side, framed like a broadcast lens.

**Broadcast cam**:
The TV-style view, elevated behind one end of the court and gently tracking the ball. Spectators watch through it, and everyone sees Instant replays through it.
_Avoid_: Spectator cam, TV cam

**Instant replay**:
A short, slowed re-showing of a notable Point (a long Rally, a Smash winner, the Golden point or the Match point) between Points, seen by everyone under a REPLAY tag. Any human Player can skip it for everyone. A human's toss cuts it short; Bots wait for it to end.

**Banner**:
The big lower-third caption shown between Points (GAME, GOLDEN POINT, SET & MATCH, FAULT, LET).
_Avoid_: Flash, toast

**Final card**:
The broadcast-style results screen at the end of a Match: winners, set score and a few Match stats ("SET & MATCH" strip, "REMATCH" vote).

**Take seat**:
What a Spectator does to replace a Bot or fill an empty Seat. Outside a Rally it happens at once; during a Rally or a toss it waits for the Point to end.
