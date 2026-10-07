/**
 * Entry point for the authoritative game server: an HTTP server (health checks /
 * Render) with a WebSocket server on top. On `join` a connection claims a player
 * slot (or becomes a spectator) and is sent a Welcome; `input` messages feed the
 * room's movement integration, and the other messages map onto room methods. The room runs the physics loop and broadcasts.
 */
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import {
  DEFAULT_SERVER_PORT,
  PROTOCOL_VERSION,
  decodeClient,
  encode,
  sanitizeName,
  type OutdatedMsg,
} from "@padel/shared";
import { Room } from "./room.js";

const PORT = Number(process.env.PORT) || DEFAULT_SERVER_PORT;

const http = createServer((req, res) => {
  if (req.url === "/health" || req.url === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("padel server ok");
    return;
  }
  res.writeHead(404);
  res.end();
});

const room = await Room.create();
room.start();

const wss = new WebSocketServer({ server: http });
let nextId = 1;

wss.on("connection", (ws) => {
  const id = `c${nextId++}`;
  const client = { id, ws, name: "Guest", lastActivity: Date.now() };
  room.addClient(client);
  let joined = false;
  console.log(`[ws] ${id} connected (${room.clientCount} total)`);

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = decodeClient(raw.toString());
    } catch {
      return;
    }

    // NB: the per-frame `input` stream is NOT counted as activity, so an AFK
    // player still idles out. Only deliberate signals refresh the idle timer.
    if (msg.t === "join") {
      if (joined) return;
      if (msg.version !== PROTOCOL_VERSION) {
        const out: OutdatedMsg = { t: "outdated", serverVersion: PROTOCOL_VERSION };
        ws.send(encode(out));
        ws.close();
        console.log(`[ws] ${id} rejected: client protocol v${msg.version}, server v${PROTOCOL_VERSION}`);
        return;
      }
      joined = true;
      room.markActivity(id);
      client.name = sanitizeName(msg.name, `Player ${id}`);
      const ps = room.claimSlot(id, client.name);
      const welcome = room.welcomeMessage(id);
      ws.send(encode(welcome));
      ws.send(encode(room.matchMessage()));
      ws.send(encode(room.voteMessage()));
      console.log(`[ws] ${id} joined as ${welcome.role}${ps ? ` ${ps.slot}` : ""}`);
    } else if (msg.t === "input") {
      room.handleInput(id, msg);
    } else if (msg.t === "activity") {
      room.markActivity(id);
    } else if (msg.t === "react") {
      room.markActivity(id);
      room.react(id, msg.id);
    } else if (msg.t === "votereset") {
      room.markActivity(id);
      room.requestResetVote(id);
    } else if (msg.t === "votedecline") {
      room.markActivity(id);
      room.declineVote(id);
    } else if (msg.t === "addbot") {
      room.markActivity(id);
      room.addBot(id);
    } else if (msg.t === "clearbots") {
      room.markActivity(id);
      room.clearBots(id);
    } else if (msg.t === "takeseat") {
      room.markActivity(id);
      room.takeSeat(id);
    } else if (msg.t === "skipreplay") {
      room.markActivity(id);
      room.skipReplay(id);
    }
  });

  ws.on("close", () => {
    room.removeClient(id);
    console.log(`[ws] ${id} disconnected (${room.clientCount} remaining)`);
  });
  ws.on("error", (err) => console.error(`[ws] ${id} error`, err));
});

http.listen(PORT, () => {
  console.log(
    `padel server (protocol v${PROTOCOL_VERSION}) listening on :${PORT}`,
  );
});
