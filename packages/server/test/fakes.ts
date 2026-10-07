import { decodeServer, type InputMsg, type ServerMessage } from "@padel/shared";
import type { Client, Room } from "../src/room.js";

/** A Client whose socket records everything the room sends it. */
export function fakeClient(id: string) {
  const sent: string[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d), close: () => {} };
  const client: Client = { id, ws: ws as unknown as Client["ws"], name: id, lastActivity: Date.now() };
  // Decoded incrementally: long physics tests call messages() every step, and re-decoding
  // everything each time is quadratic in the number of messages.
  const decoded: ServerMessage[] = [];
  const messages = (): readonly ServerMessage[] => {
    for (let i = decoded.length; i < sent.length; i++) decoded.push(decodeServer(sent[i]!));
    return decoded;
  };
  function last<T extends ServerMessage["t"]>(t: T): Extract<ServerMessage, { t: T }> | null {
    const all = messages();
    for (let i = all.length - 1; i >= 0; i--) {
      const m = all[i]!;
      if (m.t === t) return m as Extract<ServerMessage, { t: T }>;
    }
    return null;
  }
  return { client, messages, last };
}

/** Step the room until `pred` holds (checked after each step). Returns the steps taken, or null if it never held. */
export function stepUntil(room: Room, pred: () => boolean, maxSteps: number): number | null {
  for (let i = 1; i <= maxSteps; i++) {
    room.step();
    if (pred()) return i;
  }
  return null;
}

const seqs = new WeakMap<Room, Map<string, number>>();

/** Queue one input for a client, filling the fields `partial` leaves out with idle defaults. */
export function sendInput(room: Room, id: string, partial: Partial<InputMsg> = {}): void {
  const perRoom = seqs.get(room) ?? new Map<string, number>();
  seqs.set(room, perRoom);
  const seq = (perRoom.get(id) ?? 0) + 1;
  perRoom.set(id, seq);
  room.handleInput(id, {
    t: "input",
    seq,
    ts: 0,
    move: { x: 0, z: 0 },
    aim: { x: 0, z: 1 },
    shot: null,
    view: room.serverTime, // the present: no rewind
    serve: false,
    ...partial,
  });
}
