/**
 * The local player's own marker: a thin ring on the turf in the team colour, with a small chevron
 * on its rim pointing the way the player faces. Subtle (55% opacity) and inside the Timing arc.
 */
import * as THREE from "three";
import type { Team } from "@padel/shared";
import { PALETTE } from "./palette.js";

const MARK = {
  inner: 0.46,
  outer: 0.52,
  /** Chevron: its tip on the facing side, just past the ring and inside the Timing arc (0.7 m). */
  tip: 0.66,
  base: 0.55,
  halfWidth: 0.09,
  notch: 0.04,
  opacity: 0.55,
  /** Above the ball marker (0.015) and below the Timing arc (0.02). */
  y: 0.018,
} as const;

const KIT: Record<Team, string> = { A: PALETTE.azul, B: PALETTE.rojo };

export class SelfMarker {
  readonly root = new THREE.Group();
  private readonly material = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: MARK.opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    side: THREE.DoubleSide,
  });

  constructor() {
    const ring = new THREE.Mesh(new THREE.RingGeometry(MARK.inner, MARK.outer, 48).rotateX(-Math.PI / 2), this.material);
    // A chevron in the XZ plane, pointing along local +z (the avatar's forward at yaw 0).
    const shape = new THREE.Shape();
    shape.moveTo(0, MARK.tip);
    shape.lineTo(MARK.halfWidth, MARK.base);
    shape.lineTo(0, MARK.base + MARK.notch);
    shape.lineTo(-MARK.halfWidth, MARK.base);
    shape.closePath();
    // ShapeGeometry lies in XY; rotating +90° about X maps local +y to +z (flat, facing up).
    const chevron = new THREE.Mesh(new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2), this.material);
    this.root.add(ring, chevron);
    this.root.name = "self-marker";
    this.root.visible = false;
    for (const m of [ring, chevron]) m.renderOrder = 1;
  }

  setTeam(team: Team): void {
    this.material.color.set(KIT[team]);
  }

  /** Follow the player's feet and facing; hidden when there is no player to follow. */
  follow(target: THREE.Object3D | null): void {
    this.root.visible = target !== null;
    if (!target) return;
    this.root.position.set(target.position.x, MARK.y, target.position.z);
    this.root.rotation.y = target.rotation.y;
  }
}
