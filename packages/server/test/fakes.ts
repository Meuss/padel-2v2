import { decodeServer, type ServerMessage } from "@padel/shared";
import type { Client } from "../src/room.js";

/** A Client whose socket records everything the room sends it. */
export function fakeClient(id: string) {
  const sent: string[] = [];
  const ws = { readyState: 1, OPEN: 1, send: (d: string) => sent.push(d), close: () => {} };
  const client: Client = { id, ws: ws as unknown as Client["ws"], name: id, lastActivity: Date.now() };
  const messages = (): ServerMessage[] => sent.map((d) => decodeServer(d));
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
