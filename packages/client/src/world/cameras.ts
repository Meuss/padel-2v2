import * as THREE from "three";

export interface CamPose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
  fov: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Depth (m from the net, on the player's own half) where the Player cam starts to pull back… */
const DEEP_FROM = 6;
/** …and the depth (near the back glass) where it has pulled back fully. */
const DEEP_FULL = 9.5;

/** Player cam: long-lens broadcast framing behind the player's own end. Pure.
 *  `side` is the sign of the z half the player defends (-1: z<0). */
export function playerCamPose(
  player: { x: number; z: number },
  ball: { x: number; z: number } | null,
  side: -1 | 1,
): CamPose {
  const pos = new THREE.Vector3(clamp(player.x * 0.35, -3, 3), 7, side * 17);
  // How deep the play is on the player's own half: 0 up to 6 m from the net, 1 at the back glass.
  const depth = Math.max(side * player.z, ball ? side * ball.z : -Infinity);
  const deep = clamp((depth - DEEP_FROM) / (DEEP_FULL - DEEP_FROM), 0, 1);
  // Work in the player's frame (u grows toward the net). Aim 2 m behind the net on the
  // player's half so the near pair sits low in frame; the ball pulls the look point
  // toward the far end, but never beyond 4 m past the net.
  let u = -2;
  if (ball) u += (-side * ball.z - u) * 0.25;
  // Deep play (player or ball within ~4 m of the own back glass) would put feet and
  // back-glass rebounds below the frame: cancel the far-end pull, tilt the look point
  // back and widen the lens a little.
  u = Math.min(4 - 6 * deep, u) - 3.5 * deep;
  const look = new THREE.Vector3(player.x * 0.2, 0.8, -side * u);
  return { pos, look, fov: 30 + 6 * deep };
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
  /** Shake amplitude (m) requested for the next frame, and the offset applied this frame. */
  private shake = 0;
  private shakeOffset = new THREE.Vector3();

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

  /** Shake the camera by up to `amplitude` metres on the next update (an additive offset, one frame). */
  addShake(amplitude: number): void {
    this.shake += amplitude;
  }

  update(dtSec: number): void {
    // Undo last frame's shake so it never feeds the smoothing.
    this.camera.position.sub(this.shakeOffset);
    this.shakeOffset.set(0, 0, 0);
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
    if (this.shake > 0) {
      const a = this.shake;
      this.shakeOffset.set((Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a, (Math.random() * 2 - 1) * a);
      this.camera.position.add(this.shakeOffset);
      this.shake = 0;
    }
  }
}

/** Which end wall to cut away: the one on the camera's side. */
export function cutawaySide(cameraZ: number): -1 | 1 {
  return cameraZ < 0 ? -1 : 1;
}

/** Time constant of the sideways frame shift: ~95% of the way in 250 ms. */
const FRAME_SHIFT_TAU = 0.08;

/** One frame of the frame shift's ease toward its target (exponential, frame-rate independent). Pure. */
export function stepFrameShift(current: number, target: number, dt: number): number {
  const next = target + (current - target) * Math.exp(-dt / FRAME_SHIFT_TAU);
  return Math.abs(next - target) < 0.0005 ? target : next;
}
