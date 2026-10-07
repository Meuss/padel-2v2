/**
 * Authoritative Rapier physics world: the enclosed padel court (floor, four
 * glass walls, centre net) plus the dynamic ball. Colliders are tagged by kind
 * and ball contacts are surfaced each step so the match engine can adjudicate
 * points (which surface the ball hit, in what order).
 *
 * Players are NOT physics bodies — hits are resolved by proximity in the match
 * engine, so the ball never gets pushed around incidentally.
 */
import RAPIER from "@dimforge/rapier3d-compat";
import { BALL, COURT, GRAVITY, SERVE, TICK_DT, type Vec3 } from "@padel/shared";

export interface BallState {
  pos: Vec3;
  vel: Vec3;
}

export type ContactKind = "floor" | "wall" | "net";

export class PhysicsWorld {
  private constructor(
    readonly world: RAPIER.World,
    private ball: RAPIER.RigidBody,
    private ballColliderHandle: number,
    private eventQueue: RAPIER.EventQueue,
    private kinds: Map<number, ContactKind>,
  ) {}

  static async create(): Promise<PhysicsWorld> {
    await RAPIER.init();
    const world = new RAPIER.World({ x: 0, y: -GRAVITY, z: 0 });
    world.timestep = TICK_DT;

    const halfW = COURT.width / 2;
    const halfL = COURT.length / 2;
    const wallH = COURT.wallHeight;
    const t = 0.1;
    const kinds = new Map<number, ContactKind>();

    const fixed = (x: number, y: number, z: number) =>
      world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y, z));
    const add = (
      desc: RAPIER.ColliderDesc,
      body: RAPIER.RigidBody,
      kind: ContactKind,
    ) => {
      const c = world.createCollider(desc, body);
      kinds.set(c.handle, kind);
    };

    add(
      RAPIER.ColliderDesc.cuboid(halfW, t, halfL).setRestitution(0.6),
      fixed(0, -t, 0),
      "floor",
    );

    const wallRest = 0.85;
    add(
      RAPIER.ColliderDesc.cuboid(halfW, wallH / 2, t).setRestitution(wallRest),
      fixed(0, wallH / 2, -halfL),
      "wall",
    );
    add(
      RAPIER.ColliderDesc.cuboid(halfW, wallH / 2, t).setRestitution(wallRest),
      fixed(0, wallH / 2, halfL),
      "wall",
    );
    add(
      RAPIER.ColliderDesc.cuboid(t, wallH / 2, halfL).setRestitution(wallRest),
      fixed(-halfW, wallH / 2, 0),
      "wall",
    );
    add(
      RAPIER.ColliderDesc.cuboid(t, wallH / 2, halfL).setRestitution(wallRest),
      fixed(halfW, wallH / 2, 0),
      "wall",
    );

    add(
      RAPIER.ColliderDesc.cuboid(halfW, COURT.netHeight / 2, 0.03).setRestitution(
        0.3,
      ),
      fixed(0, COURT.netHeight / 2, 0),
      "net",
    );

    const ballBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(0, 3, 0)
        .setLinearDamping(BALL.linearDamping)
        .setCcdEnabled(true),
    );
    const ballCollider = world.createCollider(
      RAPIER.ColliderDesc.ball(BALL.radius)
        .setRestitution(BALL.restitution)
        .setDensity(2)
        .setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS),
      ballBody,
    );

    return new PhysicsWorld(
      world,
      ballBody,
      ballCollider.handle,
      new RAPIER.EventQueue(true),
      kinds,
    );
  }

  /** Step the simulation and return the surfaces the ball started touching. */
  step(): ContactKind[] {
    this.world.step(this.eventQueue);
    const contacts: ContactKind[] = [];
    this.eventQueue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const other =
        h1 === this.ballColliderHandle
          ? h2
          : h2 === this.ballColliderHandle
            ? h1
            : null;
      if (other === null) return;
      const kind = this.kinds.get(other);
      if (kind) contacts.push(kind);
    });
    return contacts;
  }

  ballState(): BallState {
    const p = this.ball.translation();
    const v = this.ball.linvel();
    return {
      pos: { x: p.x, y: p.y, z: p.z },
      vel: { x: v.x, y: v.y, z: v.z },
    };
  }

  ballPosition(): Vec3 {
    const p = this.ball.translation();
    return { x: p.x, y: p.y, z: p.z };
  }

  ballSpeed(): number {
    const v = this.ball.linvel();
    return Math.hypot(v.x, v.y, v.z);
  }

  /** Directly set the ball's velocity — used to resolve a player's swing. */
  setBallVelocity(x: number, y: number, z: number): void {
    this.ball.setLinvel({ x, y, z }, true);
  }

  /**
   * Place the ball at `from` and launch it to land near `to` after flightTime.
   * The launch accounts for the ball's linear damping (dv/dt = -c·v, plus gravity on
   * y), so an aimed serve lands where it was aimed rather than ~1.5 m short.
   */
  launchServe(from: Vec3, to: Vec3): void {
    const T = SERVE.flightTime;
    const c = BALL.linearDamping;
    // Distance covered in T per unit of initial speed: (1 - e^{-cT}) / c (→ T as c → 0).
    const k = c > 1e-6 ? (1 - Math.exp(-c * T)) / c : T;
    const drift = c > 1e-6 ? GRAVITY / c : 0; // terminal-velocity term of the y solution
    this.ball.setTranslation(from, true);
    this.ball.setLinvel(
      {
        x: (to.x - from.x) / k,
        y: c > 1e-6 ? (to.y - from.y + drift * T) / k - drift : (to.y - from.y) / T + 0.5 * GRAVITY * T,
        z: (to.z - from.z) / k,
      },
      true,
    );
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }

  /** Freeze the ball at a position (serve setup / between points). */
  holdBall(pos: Vec3): void {
    this.ball.setTranslation(pos, true);
    this.ball.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.ball.setAngvel({ x: 0, y: 0, z: 0 }, true);
  }
}
