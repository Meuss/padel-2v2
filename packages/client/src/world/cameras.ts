import * as THREE from "three";

export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Player cam: long-lens broadcast framing behind the player's own end. Pure.
 *  `side` is the sign of the z half the player defends (-1: z<0). */
export function playerCamPose(
  player: { x: number; z: number },
  ball: { x: number; z: number } | null,
  side: -1 | 1,
): CamPose {
  const pos = new THREE.Vector3(clamp(player.x * 0.35, -3, 3), 7, side * 17);
  // Work in the player's frame (u grows toward the net). Aim 2 m behind the net on the
  // player's half so the near pair sits low in frame; the ball pulls the look point
  // toward the far end, but never beyond 4 m past the net.
  let u = -2;
  if (ball) u += (-side * ball.z - u) * 0.25;
  u = Math.min(4, u);
  const look = new THREE.Vector3(player.x * 0.2, 0.8, -side * u);
  return { pos, look, fov: 30 };
}

/** Broadcast cam for spectators: elevated, behind the z<0 end, gently tracking the ball. Pure. */
export function broadcastCamPose(ball: { x: number; z: number } | null): CamPose {
  const bx = ball?.x ?? 0;
  const bz = ball?.z ?? 0;
  return {
    pos: new THREE.Vector3(clamp(bx * 0.1, -1, 1), 12, -21),
    look: new THREE.Vector3(clamp(bx * 0.3, -1.5, 1.5), 0.3, 0.5 + clamp(bz * 0.1, -1, 1)),
    fov: 38,
  };
}

export class CameraRig {
  private mode: "player" | "broadcast" = "broadcast";
  private player: { x: number; z: number } | null = null;
  private ball: { x: number; z: number } | null = null;
  private side: -1 | 1 = -1;
  private look = new THREE.Vector3(0, 0.5, 2);

  constructor(private camera: THREE.PerspectiveCamera) {}

  setMode(mode: "player" | "broadcast"): void {
    this.mode = mode;
  }

  setTargets(
    player: { x: number; z: number } | null,
    ball: { x: number; z: number } | null,
    side: -1 | 1,
  ): void {
    this.player = player;
    this.ball = ball;
    this.side = side;
  }

  private target(): CamPose {
    if (this.mode === "player" && this.player) return playerCamPose(this.player, this.ball, this.side);
    return broadcastCamPose(this.ball);
  }

  /** The camera's current z, for choosing the end wall to cut away. */
  get cameraZ(): number {
    return this.camera.position.z;
  }

  update(dtSec: number): void {
    const t = this.target();
    const kp = 1 - Math.exp(-dtSec * 6);
    const kf = 1 - Math.exp(-dtSec * 4);
    this.camera.position.lerp(t.pos, kp);
    this.look.lerp(t.look, kp);
    this.camera.lookAt(this.look);
    const fov = this.camera.fov + (t.fov - this.camera.fov) * kf;
    if (Math.abs(fov - this.camera.fov) > 1e-4) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }
}

/** Which end wall to cut away: the one on the camera's side. */
export function cutawaySide(cameraZ: number): -1 | 1 {
  return cameraZ < 0 ? -1 : 1;
}
