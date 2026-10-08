/**
 * WebSocket connection to the authoritative server. Owns the socket lifecycle
 * (connect, auto-reconnect with backoff) and dispatches decoded server messages
 * to subscriber callbacks. Snapshot buffering/interpolation is layered on top of
 * this in a later phase.
 */
import {
  PROTOCOL_VERSION,
  decodeServer,
  encode,
  type ClientMessage,
  type MatchMsg,
  type ReactionMsg,
  type RosterMsg,
  type ServerMessage,
  type SnapshotMsg,
  type VoteMsg,
  type WelcomeMsg,
} from "@padel/shared";

export type ConnStatus = "connecting" | "open" | "reconnecting" | "closed";

export interface NetHandlers {
  onStatus?: (status: ConnStatus) => void;
  onWelcome?: (msg: WelcomeMsg) => void;
  onRoster?: (msg: RosterMsg) => void;
  onSnapshot?: (msg: SnapshotMsg) => void;
  onMatch?: (msg: MatchMsg) => void;
  onVote?: (msg: VoteMsg) => void;
  onKicked?: (reason: string) => void;
  onOutdated?: () => void;
  onReaction?: (msg: ReactionMsg) => void;
  /** A player skipped the replay: cut back to live. */
  onReplaySkip?: () => void;
}

const DEFAULT_URL = "ws://localhost:8080";

/** The game server's ws(s) address: VITE_SERVER_URL, or the local dev server. */
export function resolveServerUrl(): string {
  const fromEnv = import.meta.env.VITE_SERVER_URL as string | undefined;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_URL;
}

export class Net {
  private ws: WebSocket | null = null;
  private url = resolveServerUrl();
  private handlers: NetHandlers;
  private reconnectDelay = 500;
  private closedByUs = false;
  private kicked = false;
  private name = "Player";

  constructor(handlers: NetHandlers) {
    this.handlers = handlers;
  }

  connect(name?: string): void {
    if (name !== undefined) this.name = name;
    this.closedByUs = false;
    this.kicked = false;
    this.open();
  }

  private open(): void {
    this.handlers.onStatus?.(this.ws ? "reconnecting" : "connecting");
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectDelay = 500;
      this.handlers.onStatus?.("open");
      this.send({ t: "join", version: PROTOCOL_VERSION, name: this.name });
    };

    ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = decodeServer(ev.data as string);
      } catch {
        return;
      }
      this.dispatch(msg);
    };

    ws.onclose = () => {
      this.ws = null;
      if (this.closedByUs || this.kicked) {
        this.handlers.onStatus?.("closed");
        return;
      }
      this.handlers.onStatus?.("reconnecting");
      setTimeout(() => this.open(), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 8000);
    };

    ws.onerror = () => ws.close();
  }

  private dispatch(msg: ServerMessage): void {
    switch (msg.t) {
      case "welcome":
        this.handlers.onWelcome?.(msg);
        break;
      case "roster":
        this.handlers.onRoster?.(msg);
        break;
      case "snapshot":
        this.handlers.onSnapshot?.(msg);
        break;
      case "match":
        this.handlers.onMatch?.(msg);
        break;
      case "vote":
        this.handlers.onVote?.(msg);
        break;
      case "outdated":
        // Reconnecting would only be rejected again: stop, like a kick.
        this.kicked = true;
        this.handlers.onOutdated?.();
        break;
      case "kicked":
        this.kicked = true;
        this.handlers.onKicked?.(msg.reason);
        break;
      case "reaction":
        this.handlers.onReaction?.(msg);
        break;
      case "replayskip":
        this.handlers.onReplaySkip?.();
        break;
    }
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encode(msg));
    }
  }

  close(): void {
    this.closedByUs = true;
    this.ws?.close();
  }
}
