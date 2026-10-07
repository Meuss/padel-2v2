import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AvatarFactory, pickLocomotion, shirtName, type Locomotion, type ModelSource } from "../src/world/avatar.js";
import { PALETTE } from "../src/world/palette.js";

const flush = () => new Promise((r) => setTimeout(r, 0));

const CLIPS = [
  "Idle_Loop",
  "Crouch_Idle_Loop",
  "Jog_Fwd_Loop",
  "Sprint_Loop",
  "Sword_Attack",
  "Punch_Cross",
  "Dance_Loop",
  "Jump_Start",
];

/** A tiny skinned rig shaped like the real export: bones, two materials, one clip per name. */
function syntheticModel(): { scene: THREE.Object3D; animations: THREE.AnimationClip[]; main: THREE.Material } {
  const hips = new THREE.Bone();
  hips.name = "DEF-hips";
  const spine = new THREE.Bone();
  spine.name = "DEF-spine.003";
  spine.position.y = 1.2;
  const hand = new THREE.Bone();
  hand.name = "DEF-hand.R";
  hand.position.set(-0.3, 0.2, 0);
  hips.add(spine);
  spine.add(hand);

  const geo = new THREE.BoxGeometry(0.4, 1.8, 0.3, 1, 2, 1);
  geo.translate(0, 0.9, 0);
  const n = geo.attributes.position!.count;
  geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
  geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  geo.addGroup(0, geo.index!.count / 2, 0);
  geo.addGroup(geo.index!.count / 2, geo.index!.count / 2, 1);
  const main = new THREE.MeshStandardMaterial({ name: "M_Main" });
  const joints = new THREE.MeshStandardMaterial({ name: "M_Joints" });
  const mesh = new THREE.SkinnedMesh(geo, [main, joints]);
  mesh.name = "Mannequin";
  const rig = new THREE.Group();
  rig.name = "Rig";
  rig.add(hips, mesh);
  mesh.bind(new THREE.Skeleton([hips, spine, hand]));

  const animations = CLIPS.map(
    (name) =>
      new THREE.AnimationClip(name, 1, [
        new THREE.QuaternionKeyframeTrack("DEF-hips.quaternion", [0], [0, 0, 0, 1]),
      ]),
  );
  return { scene: rig, animations, main };
}

describe("pickLocomotion", () => {
  it("stands still below 0.35 m/s, ready when the ball is on our side", () => {
    expect(pickLocomotion(0, false, "idle")).toBe("idle");
    expect(pickLocomotion(0.34, false, "idle")).toBe("idle");
    expect(pickLocomotion(0.2, true, "idle")).toBe("ready");
    expect(pickLocomotion(0.2, false, "ready")).toBe("idle");
  });

  it("jogs up to 4.2 m/s, then sprints", () => {
    expect(pickLocomotion(0.45, false, "idle")).toBe("jog");
    expect(pickLocomotion(4.19, true, "jog")).toBe("jog");
    expect(pickLocomotion(4.3, false, "jog")).toBe("sprint");
    expect(pickLocomotion(7, true, "idle")).toBe("sprint");
  });

  it("holds the current clip within 0.1 m/s of a threshold", () => {
    expect(pickLocomotion(0.4, false, "idle")).toBe("idle");
    expect(pickLocomotion(0.3, false, "jog")).toBe("jog");
    expect(pickLocomotion(0.24, false, "jog")).toBe("idle");
    expect(pickLocomotion(0.3, true, "ready")).toBe("ready");
    expect(pickLocomotion(4.25, false, "jog")).toBe("jog");
    expect(pickLocomotion(4.15, false, "sprint")).toBe("sprint");
    expect(pickLocomotion(4.05, false, "sprint")).toBe("jog");
  });

  it("does not flip on every sample when the speed oscillates 0.30 ↔ 0.40", () => {
    let loco: Locomotion = "idle";
    let flips = 0;
    for (let i = 0; i < 20; i++) {
      const next = pickLocomotion(i % 2 === 0 ? 0.3 : 0.4, false, loco);
      if (next !== loco) flips++;
      loco = next;
    }
    expect(flips).toBe(0);
  });
});

describe("Avatar speed estimate", () => {
  it("resets to 0 on a teleport over 2 m instead of reading it as a run", () => {
    const avatar = new AvatarFactory({ load: () => new Promise(() => {}) }).create("A1", "A");
    const speed = () => (avatar as unknown as { speed: number }).speed;
    for (let i = 0; i <= 30; i++) avatar.setPose(0, 0, -5 + i * 0.05, 0, 1 / 60); // 3 m/s
    expect(speed()).toBeGreaterThan(2);
    avatar.setPose(0, 0, 5, 0, 1 / 60); // ends swap: ~8.5 m in one frame
    expect(speed()).toBe(0);
    avatar.setPose(0, 0, 5, 0, 1 / 60);
    expect(speed()).toBe(0);
    avatar.dispose();
  });

  it("blends an interrupted crossfade from the current weights, without a pop", async () => {
    const avatar = new AvatarFactory({ load: () => Promise.resolve(syntheticModel()) }).create("A1", "A");
    await flush();
    const internals = avatar as unknown as { mixer: THREE.AnimationMixer; clips: Map<string, THREE.AnimationClip> };
    const action = (name: string) => internals.mixer.existingAction(internals.clips.get(name)!)!;
    const dt = 1 / 60;
    let z = -5;
    avatar.setPose(0, 0, z, 0, dt);
    avatar.update(dt);
    const idle = action("Idle_Loop");
    expect(idle.getEffectiveWeight()).toBe(1);
    const weights: number[] = [];
    for (let i = 0; i < 2; i++) {
      avatar.setPose(0, 0, (z += 0.05), 0, dt); // 3 m/s for two frames: start jogging
      avatar.update(dt);
      weights.push(idle.getEffectiveWeight());
    }
    expect(action("Jog_Fwd_Loop").getEffectiveWeight()).toBeGreaterThan(0);
    for (let i = 0; i < 40; i++) {
      avatar.setPose(0, 0, z, 0, dt); // stop: back to idle before the jog has fully faded in
      avatar.update(dt);
      weights.push(idle.getEffectiveWeight());
    }
    const step = dt / 0.18 + 1e-4;
    weights.reduce((prev, w) => {
      expect(Math.abs(w - prev)).toBeLessThanOrEqual(step);
      return w;
    }, 1);
    expect(weights.at(-1)).toBe(1);
    expect(action("Jog_Fwd_Loop").isRunning()).toBe(false);
    avatar.dispose();
  });
});

describe("AvatarFactory", () => {
  it("shows a working fallback avatar when the model fails to load", async () => {
    const failing: ModelSource = { load: () => Promise.reject(new Error("offline")) };
    const avatar = new AvatarFactory(failing).create("A1", "A");
    expect(avatar.root.children.length).toBeGreaterThan(0);
    await flush();
    expect(avatar.root.children.length).toBeGreaterThan(0);
    const parent = new THREE.Group();
    parent.add(avatar.root);
    expect(() => {
      avatar.setPose(1, 0, -3, 0.5, 1 / 60);
      avatar.setBallSide(true);
      avatar.swing("drive");
      avatar.celebrate();
      avatar.setName("Ana");
      avatar.update(1 / 60);
      avatar.update(0.5);
      avatar.dispose();
    }).not.toThrow();
    expect(avatar.root.parent).toBeNull();
  });

  it("upgrades to the cloned rig with its own team-coloured kit", async () => {
    const model = syntheticModel();
    const source: ModelSource = { load: () => Promise.resolve(model) };
    const avatar = new AvatarFactory(source).create("B2", "B");
    const parent = new THREE.Group();
    parent.add(avatar.root);
    await flush();

    const skinned: THREE.SkinnedMesh[] = [];
    avatar.root.traverse((o) => {
      if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh);
    });
    expect(skinned).toHaveLength(1);
    expect(skinned[0]).not.toBe(model.scene.children[1]);
    const mats = skinned[0]!.material as THREE.MeshStandardMaterial[];
    const main = mats.find((m) => m.name === "M_Main")!;
    expect(main).toBeDefined();
    expect(main).not.toBe(model.main);
    expect(main.color.getHexString()).toBe(PALETTE.rojo.slice(1));
    expect(mats.find((m) => m.name === "M_Joints")!.color.getHexString()).toBe(PALETTE.joints.slice(1));

    expect(() => {
      avatar.setPose(0, 0, 4, Math.PI, 1 / 60);
      avatar.setPose(0.1, 0, 4, Math.PI, 1 / 60);
      avatar.swing("smash");
      avatar.update(1 / 60);
      avatar.celebrate();
      avatar.update(3);
    }).not.toThrow();

    avatar.dispose();
    expect(avatar.root.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
  });

  it("loads the model once for many avatars", async () => {
    let loads = 0;
    const model = syntheticModel();
    const source: ModelSource = {
      load: () => {
        loads++;
        return Promise.resolve(model);
      },
    };
    const factory = new AvatarFactory(source);
    const a = factory.create("A1", "A");
    const b = factory.create("A2", "A");
    await flush();
    expect(loads).toBe(1);
    const meshesOf = (root: THREE.Object3D) => {
      const out: THREE.Object3D[] = [];
      root.traverse((o) => {
        if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o);
      });
      return out;
    };
    expect(meshesOf(a.root)[0]).not.toBe(meshesOf(b.root)[0]);
  });
});

/** Skinned meshes under an avatar root: one once the mannequin is in, none on the fallback. */
function skinnedOf(root: THREE.Object3D): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh) out.push(o);
  });
  return out;
}

describe("AvatarFactory recovery", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("upgrades every waiting avatar when a later load succeeds", async () => {
    let loads = 0;
    const model = syntheticModel();
    const source: ModelSource = {
      load: () => (++loads === 1 ? Promise.reject(new Error("cold start")) : Promise.resolve(model)),
    };
    const factory = new AvatarFactory(source);
    const a = factory.create("A1", "A"); // first load fails
    await flush();
    expect(skinnedOf(a.root)).toHaveLength(0);
    const b = factory.create("B1", "B"); // retries the load, which succeeds
    await flush();
    expect(loads).toBe(2);
    expect(skinnedOf(a.root)).toHaveLength(1);
    expect(skinnedOf(b.root)).toHaveLength(1);
  });

  it("retries a failed load once after 5 s, without a new avatar, and upgrades all waiting avatars", async () => {
    vi.useFakeTimers();
    let loads = 0;
    const model = syntheticModel();
    const source: ModelSource = {
      load: () => (++loads === 1 ? Promise.reject(new Error("cold start")) : Promise.resolve(model)),
    };
    const factory = new AvatarFactory(source);
    const a = factory.create("A1", "A");
    const b = factory.create("A2", "A");
    await vi.advanceTimersByTimeAsync(4900);
    expect(loads).toBe(1);
    expect(skinnedOf(a.root)).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(200);
    expect(loads).toBe(2);
    expect(skinnedOf(a.root)).toHaveLength(1);
    expect(skinnedOf(b.root)).toHaveLength(1);
  });

  it("retries automatically only once", async () => {
    vi.useFakeTimers();
    let loads = 0;
    const factory = new AvatarFactory({
      load: () => {
        loads++;
        return Promise.reject(new Error("offline"));
      },
    });
    factory.create("A1", "A");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(loads).toBe(2);
  });

  it("adds no body to an avatar disposed before the model arrives", async () => {
    const model = syntheticModel();
    let resolve!: (m: typeof model) => void;
    const source: ModelSource = { load: () => new Promise((r) => (resolve = r)) };
    const factory = new AvatarFactory(source);
    const avatar = factory.create("B2", "B");
    const parent = new THREE.Group();
    parent.add(avatar.root);
    avatar.dispose();
    resolve(model);
    await flush();
    expect(skinnedOf(avatar.root)).toHaveLength(0);
    expect(avatar.root.parent).toBeNull();
    expect(parent.children).toHaveLength(0);
    // A later avatar still gets the mannequin.
    expect(skinnedOf(factory.create("A1", "A").root)).toHaveLength(1);
  });
});

describe("shirtName", () => {
  it("uppercases and caps the nickname at 10 characters with an ellipsis", () => {
    expect(shirtName(" ana ")).toBe("ANA");
    expect(shirtName("Bot Heidi")).toBe("BOT HEIDI");
    expect(shirtName("Bot Mr Bean")).toBe("BOT MR BE…");
    expect(shirtName("Bot Mr Bean")).toHaveLength(10);
  });
});
