import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { broadcastCamPose, CameraRig, cutawaySide, playerCamPose, stepFrameShift } from "../src/world/cameras.js";

describe("playerCamPose", () => {
  it("sits behind the back glass, high, with a long lens (side -1)", () => {
    const p = playerCamPose({ x: 0, z: -6 }, null, -1);
    expect(p.pos.z).toBeLessThan(-10);
    expect(p.pos.y).toBeGreaterThanOrEqual(6);
    expect(p.pos.y).toBeLessThanOrEqual(10);
    expect(p.look.z).toBeGreaterThan(-6);
    expect(p.fov).toBeGreaterThanOrEqual(30);
    expect(p.fov).toBeLessThanOrEqual(38);
  });

  it("mirrors for side +1", () => {
    const a = playerCamPose({ x: 2, z: -6 }, { x: 1, z: 5 }, -1);
    const b = playerCamPose({ x: 2, z: 6 }, { x: 1, z: -5 }, 1);
    expect(b.pos.z).toBeCloseTo(-a.pos.z);
    expect(b.look.z).toBeCloseTo(-a.look.z);
    expect(b.pos.y).toBeCloseTo(a.pos.y);
    expect(b.fov).toBe(a.fov);
  });

  it("shifts the look toward the ball but never past z=+4", () => {
    const none = playerCamPose({ x: 0, z: -6 }, null, -1);
    const far = playerCamPose({ x: 0, z: -6 }, { x: 0, z: 9 }, -1);
    expect(far.look.z).toBeGreaterThan(none.look.z);
    expect(far.look.z).toBeLessThanOrEqual(4);
    expect(playerCamPose({ x: 0, z: -6 }, { x: 0, z: 1000 }, -1).look.z).toBeLessThanOrEqual(4);
  });

  it("follows player.x * 0.35 clamped to +-3", () => {
    expect(playerCamPose({ x: 4, z: -6 }, null, -1).pos.x).toBeCloseTo(1.4);
    expect(playerCamPose({ x: 100, z: -6 }, null, -1).pos.x).toBe(3);
    expect(playerCamPose({ x: -100, z: -6 }, null, -1).pos.x).toBe(-3);
  });
});

/** Normalized device coordinates of `pt` seen through `pose` on a 16:9 screen. */
function ndc(pose: ReturnType<typeof playerCamPose>, pt: [number, number, number]): THREE.Vector3 {
  const cam = new THREE.PerspectiveCamera(pose.fov, 16 / 9, 0.1, 300);
  cam.position.copy(pose.pos);
  cam.lookAt(pose.look);
  cam.updateMatrixWorld();
  return new THREE.Vector3(...pt).project(cam);
}

function expectInFrame(v: THREE.Vector3): void {
  expect(Math.abs(v.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(v.y)).toBeLessThanOrEqual(1);
  expect(v.z).toBeLessThan(1); // in front of the camera, inside the far plane
}

// `side` is the sign of the half the player defends, so its own back glass is at z = side * 10
// and the far baseline at z = -side * 10.
describe("playerCamPose framing (16:9 projection)", () => {
  for (const side of [-1, 1] as const) {
    it(`keeps the ground at the own back glass in frame with the player deep (side ${side})`, () => {
      for (const ball of [null, { x: 0, z: side * 9.7 }, { x: 0, z: -side * 8 }]) {
        const pose = playerCamPose({ x: 0, z: side * 9.5 }, ball, side);
        expectInFrame(ndc(pose, [0, 0, side * 9.7]));
        expectInFrame(ndc(pose, [3, 0, side * 9.5]));
        expectInFrame(ndc(pose, [-3, 0, side * 9.5]));
      }
    });

    it(`keeps a ball rebounding off the own back glass in frame from mid-court (side ${side})`, () => {
      const pose = playerCamPose({ x: 0, z: side * 6 }, { x: 0, z: side * 9.7 }, side);
      expectInFrame(ndc(pose, [0, 0, side * 9.7]));
    });

    it(`keeps the far baseline in frame with the player at mid-court (side ${side})`, () => {
      const pose = playerCamPose({ x: 0, z: side * 6 }, null, side);
      expectInFrame(ndc(pose, [0, 0, -side * 10]));
    });
  }
});

describe("broadcastCamPose", () => {
  it("default framing without a ball", () => {
    const p = broadcastCamPose(null);
    expect(p.pos.x).toBeCloseTo(0);
    expect(p.pos.y).toBeCloseTo(12, 0);
    expect(p.pos.z).toBeCloseTo(-21, 0);
    expect(p.look.y).toBeCloseTo(0.3);
    expect(p.look.z).toBeCloseTo(0.5, 0);
    expect(p.fov).toBeCloseTo(38, 0);
  });

  it("limits how far the look point follows the ball", () => {
    expect(Math.abs(broadcastCamPose({ x: 4, z: 0 }).look.x)).toBeLessThanOrEqual(1.5);
    expect(Math.abs(broadcastCamPose({ x: 400, z: 0 }).look.x)).toBeLessThanOrEqual(1.5);
  });
});

describe("CameraRig", () => {
  function run(dt: number): { cam: THREE.PerspectiveCamera; look: THREE.Vector3 } {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    cam.position.set(30, 40, 50);
    const rig = new CameraRig(cam);
    rig.setMode("player");
    rig.setTargets({ x: 1, z: -6 }, { x: 0, z: 3 }, -1);
    for (let i = 0; i < Math.round(3 / dt); i++) rig.update(dt);
    const look = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
    return { cam, look };
  }

  it("converges to the target pose within 1 cm in 3 s", () => {
    const { cam, look } = run(1 / 60);
    const t = playerCamPose({ x: 1, z: -6 }, { x: 0, z: 3 }, -1);
    expect(cam.position.distanceTo(t.pos)).toBeLessThan(0.01);
    expect(cam.fov).toBeCloseTo(t.fov, 1);
    const want = t.look.clone().sub(t.pos).normalize();
    expect(look.angleTo(want)).toBeLessThan(0.001); // view direction has converged too
  });

  it("falls back to the broadcast pose in player mode without a player", () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    const rig = new CameraRig(cam);
    rig.setMode("player");
    rig.setTargets(null, null, -1);
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    expect(cam.position.distanceTo(broadcastCamPose(null).pos)).toBeLessThan(0.01);
  });

  it("converges to the mirrored pose after an ends swap", () => {
    const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    const rig = new CameraRig(cam);
    rig.setMode("player");
    rig.setTargets({ x: 1, z: -6 }, null, -1);
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    rig.setTargets({ x: 1, z: 6 }, null, 1);
    for (let i = 0; i < 180; i++) rig.update(1 / 60);
    const t = playerCamPose({ x: 1, z: 6 }, null, 1);
    expect(cam.position.distanceTo(t.pos)).toBeLessThan(0.01);
    expect(cam.position.z).toBeGreaterThan(10);
    expect(rig.cameraZ).toBe(cam.position.z);
  });

  it("is frame-rate independent", () => {
    const a = run(1 / 60).cam;
    const b = run(1 / 30).cam;
    expect(a.position.distanceTo(b.position)).toBeLessThan(0.02);
  });
});

describe("cutawaySide", () => {
  it("cuts the end on the camera's side", () => {
    expect(cutawaySide(-17)).toBe(-1);
    expect(cutawaySide(17)).toBe(1);
  });
});

describe("CameraRig.addShake", () => {
  const rig = () => {
    const cam = new THREE.PerspectiveCamera(36, 1, 0.1, 300);
    return { cam, rig: new CameraRig(cam) };
  };

  it("offsets the camera by at most the amplitude for one frame, then returns to the unshaken path", () => {
    const a = rig();
    const b = rig();
    a.rig.update(1 / 60);
    b.rig.update(1 / 60);
    b.rig.addShake(0.06);
    a.rig.update(1 / 60);
    b.rig.update(1 / 60);
    const d = b.cam.position.clone().sub(a.cam.position);
    expect(d.length()).toBeGreaterThan(0);
    expect(Math.max(Math.abs(d.x), Math.abs(d.y), Math.abs(d.z))).toBeLessThanOrEqual(0.06);
    a.rig.update(1 / 60);
    b.rig.update(1 / 60);
    expect(b.cam.position.distanceTo(a.cam.position)).toBeLessThan(1e-9);
  });
});

describe("stepFrameShift", () => {
  it("eases toward the target instead of snapping", () => {
    const next = stepFrameShift(0, 0.2, 1 / 60);
    expect(next).toBeGreaterThan(0);
    expect(next).toBeLessThan(0.05);
  });

  it("is most of the way there after ~250 ms and lands exactly soon after", () => {
    let s = 0.2;
    for (let i = 0; i < 15; i++) s = stepFrameShift(s, 0, 1 / 60);
    expect(s).toBeLessThan(0.02);
    for (let i = 0; i < 30; i++) s = stepFrameShift(s, 0, 1 / 60);
    expect(s).toBe(0);
  });

  it("does not depend on the frame rate", () => {
    let a = 0;
    for (let i = 0; i < 6; i++) a = stepFrameShift(a, 0.2, 1 / 60);
    const b = stepFrameShift(0, 0.2, 6 / 60);
    expect(a).toBeCloseTo(b, 6);
  });
});
