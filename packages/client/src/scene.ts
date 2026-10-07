/**
 * Three.js rendering of the padel court. Builds static geometry from the
 * server-provided CourtConfig and exposes setters for the dynamic entities
 * (ball, players) that the network layer updates each frame.
 *
 * The look is procedural (no external assets): a blue court with painted lines,
 * a black-framed glass cage, a net with posts, and capsule avatars holding
 * rackets — lit stadium-style with filmic tone mapping.
 */
import * as THREE from "three";
import {
  BALL,
  PLAYER,
  type CourtConfig,
  type FaultHighlight,
  type Slot,
  type Team,
  type Vec2,
} from "@padel/shared";

const TEAM_COLOR: Record<Team, number> = { A: 0x3b82f6, B: 0xef4444 };
const FRAME_COLOR = 0x12161f;

export class PadelScene {
  readonly scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private camera: THREE.PerspectiveCamera;
  private ball: THREE.Mesh;
  private players = new Map<Slot, THREE.Group>();
  private court: CourtConfig | null = null;
  private cameraMode: "spectator" | "player" = "spectator";
  private camTeam: Team = "A";
  private camPos = new THREE.Vector3(0, 16, 24);
  private camLook = new THREE.Vector3(0, 1, 0);
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private swingStart = new Map<Slot, number>();
  private fenceTex: THREE.Texture | null = null;
  private markers: { mesh: THREE.Mesh; born: number; ttl: number }[] = [];

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x0a0e1a);
    this.scene.fog = new THREE.Fog(0x0a0e1a, 45, 90);

    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);

    this.addLights();
    this.addSurroundings();

    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL.radius, 24, 18),
      new THREE.MeshStandardMaterial({
        color: 0xdcff4a,
        emissive: 0x3a4a00,
        emissiveIntensity: 0.4,
        roughness: 0.5,
      }),
    );
    this.ball.castShadow = true;
    this.ball.position.set(0, 1, 0);
    this.scene.add(this.ball);

    this.onResize();
    window.addEventListener("resize", this.onResize);
  }

  private addLights(): void {
    this.scene.add(new THREE.HemisphereLight(0xcdddff, 0x1a2030, 0.7));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(10, 26, 14);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    const s = 18;
    key.shadow.camera.left = -s;
    key.shadow.camera.right = s;
    key.shadow.camera.top = s;
    key.shadow.camera.bottom = -s;
    key.shadow.bias = -0.0004;
    this.scene.add(key);

    const fill = new THREE.DirectionalLight(0x88aaff, 0.5);
    fill.position.set(-14, 12, -10);
    this.scene.add(fill);
  }

  private addSurroundings(): void {
    // Large dark ground beyond the court so the scene doesn't float in void.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0x0c1320, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    this.scene.add(ground);
  }

  buildCourt(court: CourtConfig): void {
    // The court is static and a Welcome arrives on every (re)connect: build once.
    if (this.court) return;
    this.court = court;
    const halfW = court.width / 2;
    const halfL = court.length / 2;

    // Court surface.
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(court.width, court.length),
      new THREE.MeshStandardMaterial({ color: 0x1c6e87, roughness: 0.85 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    // A slightly larger surround "playing surface" border.
    const surround = new THREE.Mesh(
      new THREE.PlaneGeometry(court.width + 2.4, court.length + 2.4),
      new THREE.MeshStandardMaterial({ color: 0x14313a, roughness: 0.95 }),
    );
    surround.rotation.x = -Math.PI / 2;
    surround.position.y = -0.02;
    surround.receiveShadow = true;
    this.scene.add(surround);

    this.addLines(halfW, halfL);
    this.addCage(court, halfW, halfL);
    this.addNet(court, halfW);
    this.addStickers(halfL);
  }

  /** Painted court lines as thin white strips just above the floor. */
  private addLines(halfW: number, halfL: number): void {
    const mat = new THREE.MeshStandardMaterial({
      color: 0xeef4ff,
      roughness: 0.6,
      emissive: 0x223047,
      emissiveIntensity: 0.2,
    });
    const W = 0.06; // line width
    const y = 0.015;
    const lineX = (z: number, x0: number, x1: number) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, W), mat);
      g.rotation.x = -Math.PI / 2;
      g.position.set((x0 + x1) / 2, y, z);
      this.scene.add(g);
    };
    const lineZ = (x: number, z0: number, z1: number) => {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(W, z1 - z0), mat);
      g.rotation.x = -Math.PI / 2;
      g.position.set(x, y, (z0 + z1) / 2);
      this.scene.add(g);
    };
    // Outer boundary.
    lineX(-halfL, -halfW, halfW);
    lineX(halfL, -halfW, halfW);
    lineZ(-halfW, -halfL, halfL);
    lineZ(halfW, -halfL, halfL);
    // Service lines (regulation: 6.95 m from the net) + centre service line.
    const sv = Math.min(halfL - 0.2, 6.95);
    lineX(-sv, -halfW, halfW);
    lineX(sv, -halfW, halfW);
    lineZ(0, -sv, sv);
  }

  /** Repeating metallic-mesh (fence) material sized for a given panel. */
  private fenceMaterial(w: number, h: number): THREE.Material {
    if (!this.fenceTex) {
      const s = 64;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = s;
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, s, s);
      // White wires on a transparent tile → one grid cell that tiles into mesh.
      // (alphaMap reads luminance: white = opaque wire, transparent = hole.)
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 7;
      ctx.strokeRect(0, 0, s, s);
      const tex = new THREE.CanvasTexture(canvas);
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      this.fenceTex = tex;
    }
    const tex = this.fenceTex.clone();
    tex.needsUpdate = true;
    const cell = 0.18; // metres per mesh cell
    tex.repeat.set(
      Math.max(1, Math.round(w / cell)),
      Math.max(1, Math.round(h / cell)),
    );
    return new THREE.MeshStandardMaterial({
      color: 0xaab2bc,
      metalness: 0.4,
      roughness: 0.6,
      alphaMap: tex,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
  }

  /**
   * The padel "cage": glass on the lower court (both ends + corner returns on
   * the long sides) and metallic mesh fence on the top metre everywhere and
   * across the middle of the long sides — divided by metal posts and rails.
   */
  private addCage(court: CourtConfig, halfW: number, halfL: number): void {
    const wallH = court.wallHeight; // 4
    const glassH = court.glassHeight; // 3
    const meshH = wallH - glassH; // 1

    // Simple tinted transparent glass. (No `transmission`: without an
    // environment map it renders dark/murky and fights other transparent meshes.)
    const glass = new THREE.MeshStandardMaterial({
      color: 0xcdebff,
      transparent: true,
      opacity: 0.16,
      roughness: 0.1,
      metalness: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const frameMat = new THREE.MeshStandardMaterial({
      color: FRAME_COLOR,
      roughness: 0.5,
      metalness: 0.6,
    });

    const glassPanel = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      rotY: number,
    ) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), glass);
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      this.scene.add(m);
    };
    const meshPanel = (
      w: number,
      h: number,
      x: number,
      y: number,
      z: number,
      rotY: number,
    ) => {
      const m = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        this.fenceMaterial(w, h),
      );
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      this.scene.add(m);
    };

    // End walls: glass on the bottom, mesh fence on the top.
    for (const z of [-halfL, halfL]) {
      glassPanel(court.width, glassH, 0, glassH / 2, z, 0);
      meshPanel(court.width, meshH, 0, glassH + meshH / 2, z, 0);
    }

    // Side walls: the 3 panels nearest the net on each side are cage (mesh),
    // the 2 outer panels toward each corner are glass, and the top metre is mesh
    // all around — i.e. window window | cage cage cage | NET | cage cage cage | window window.
    const meshHalf = 6; // mesh extends 6 m (3 × 2 m panels) each way from the net
    const glassLen = halfL - meshHalf; // outer glass length on each side
    for (const x of [-halfW, halfW]) {
      meshPanel(meshHalf * 2, glassH, x, glassH / 2, 0, Math.PI / 2);
      for (const sgn of [-1, 1]) {
        const cz = sgn * (meshHalf + glassLen / 2);
        glassPanel(glassLen, glassH, x, glassH / 2, cz, Math.PI / 2);
      }
      meshPanel(court.length, meshH, x, glassH + meshH / 2, 0, Math.PI / 2);
    }

    // Vertical posts ~every 2 m along all walls (includes corners + net line).
    const post = (x: number, z: number) => {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.12, wallH, 0.12), frameMat);
      p.position.set(x, wallH / 2, z);
      p.castShadow = true;
      this.scene.add(p);
    };
    for (const z of [-halfL, halfL]) {
      for (let i = 0; i <= 5; i++) post(-halfW + (court.width / 5) * i, z);
    }
    for (const x of [-halfW, halfW]) {
      for (let i = 0; i <= 10; i++) post(x, -halfL + (court.length / 10) * i);
    }

    // Horizontal rails: top of the cage and along the glass/mesh seam.
    const rail = (w: number, x: number, y: number, z: number, rotY: number) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.08, 0.08), frameMat);
      r.position.set(x, y, z);
      r.rotation.y = rotY;
      this.scene.add(r);
    };
    for (const y of [wallH, glassH]) {
      rail(court.width, 0, y, -halfL, 0);
      rail(court.width, 0, y, halfL, 0);
      rail(court.length, -halfW, y, 0, Math.PI / 2);
      rail(court.length, halfW, y, 0, Math.PI / 2);
    }
  }

  private addNet(court: CourtConfig, halfW: number): void {
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(court.width, court.netHeight),
      new THREE.MeshStandardMaterial({
        color: 0x0b0e16,
        transparent: true,
        opacity: 0.6,
        side: THREE.DoubleSide,
        roughness: 0.9,
      }),
    );
    mesh.position.set(0, court.netHeight / 2, 0);
    this.scene.add(mesh);

    // White tape along the top.
    const tape = new THREE.Mesh(
      new THREE.BoxGeometry(court.width, 0.05, 0.04),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 }),
    );
    tape.position.set(0, court.netHeight, 0);
    this.scene.add(tape);

    // Posts.
    const postMat = new THREE.MeshStandardMaterial({
      color: FRAME_COLOR,
      metalness: 0.6,
      roughness: 0.5,
    });
    for (const x of [-halfW, halfW]) {
      const p = new THREE.Mesh(
        new THREE.CylinderGeometry(0.05, 0.05, court.netHeight + 0.1, 12),
        postMat,
      );
      p.position.set(x, (court.netHeight + 0.1) / 2, 0);
      this.scene.add(p);
    }
  }

  /**
   * The Marvelous banner on both end-wall glass panels, on a brand-pink badge.
   * Each faces the court interior, so it reads correctly from inside and appears
   * mirrored from outside. Loaded asynchronously and added once ready.
   */
  private addStickers(halfL: number): void {
    const ORANGE = "#ffab05";
    const base = import.meta.env.BASE_URL;
    const logoH = 0.95;
    const logoW = logoH * (197 / 57); // preserve the wordmark aspect
    type Place = {
      name: string;
      face: "+z" | "-z" | "+x" | "-x";
      x: number;
      y: number;
      z: number;
      w: number;
      h: number;
    };
    const places: Place[] = [
      { name: "logo-white", face: "+z", x: 0, y: 1.7, z: -halfL, w: logoW, h: logoH },
      { name: "logo-white", face: "-z", x: 0, y: 1.7, z: halfL, w: logoW, h: logoH },
    ];

    for (const p of places) {
      this.loadSvgImage(`${base}stickers/${p.name}.svg`)
        .then((img) => {
          const tex = this.makeStickerTexture(img, ORANGE, p.w, p.h);
          // Alpha-tested opaque decal: the rounded corners are cut out, but the
          // badge writes depth like a solid sticker, so it never gets sorted
          // into triangle artifacts against the transparent glass.
          const mat = new THREE.MeshBasicMaterial({
            map: tex,
            transparent: false,
            alphaTest: 0.5,
            side: THREE.FrontSide,
            toneMapped: false,
          });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(p.w, p.h), mat);
          const eps = 0.05;
          const rot: Record<Place["face"], number> = {
            "+z": 0,
            "-z": Math.PI,
            "+x": Math.PI / 2,
            "-x": -Math.PI / 2,
          };
          const off: Record<Place["face"], [number, number]> = {
            "+z": [0, eps],
            "-z": [0, -eps],
            "+x": [eps, 0],
            "-x": [-eps, 0],
          };
          mesh.rotation.y = rot[p.face];
          mesh.position.set(p.x + off[p.face][0], p.y, p.z + off[p.face][1]);
          this.scene.add(mesh);
        })
        .catch(() => {
          /* missing sticker asset — skip silently */
        });
    }
  }

  /** Load an SVG as an Image, normalized to a crisp intrinsic size. */
  private async loadSvgImage(url: string): Promise<HTMLImageElement> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`sticker ${url}: ${res.status}`);
    let svg = await res.text();
    const m = svg.match(/viewBox="([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)"/);
    if (m) {
      const vw = parseFloat(m[3]!);
      const vh = parseFloat(m[4]!);
      const k = 512 / Math.max(vw, vh);
      svg = svg
        .replace(/\swidth="[^"]*"/, "")
        .replace(/\sheight="[^"]*"/, "")
        .replace(/<svg/, `<svg width="${Math.round(vw * k)}" height="${Math.round(vh * k)}"`);
    }
    const blobUrl = URL.createObjectURL(
      new Blob([svg], { type: "image/svg+xml" }),
    );
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        resolve(img);
      };
      img.onerror = (e) => {
        URL.revokeObjectURL(blobUrl);
        reject(e);
      };
      img.src = blobUrl;
    });
  }

  /** Draw a logo onto an orange rounded-rect badge and return it as a texture. */
  private makeStickerTexture(
    img: HTMLImageElement,
    orange: string,
    w: number,
    h: number,
  ): THREE.Texture {
    const cw = Math.round(w * 256);
    const ch = Math.round(h * 256);
    const canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d")!;
    const r = Math.min(cw, ch) * 0.16;
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.arcTo(cw, 0, cw, ch, r);
    ctx.arcTo(cw, ch, 0, ch, r);
    ctx.arcTo(0, ch, 0, 0, r);
    ctx.arcTo(0, 0, cw, 0, r);
    ctx.closePath();
    ctx.fillStyle = orange;
    ctx.fill();

    const pad = Math.min(cw, ch) * 0.16;
    const availW = cw - 2 * pad;
    const availH = ch - 2 * pad;
    const scale = Math.min(availW / img.width, availH / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (cw - dw) / 2, (ch - dh) / 2, dw, dh);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }

  /** Lazily create and return the avatar group for a slot. */
  private avatar(slot: Slot): THREE.Group {
    let g = this.players.get(slot);
    if (g) return g;
    g = new THREE.Group();
    const group = g;
    const team: Team = slot.startsWith("A") ? "A" : "B";
    const color = TEAM_COLOR[team];

    // Stylized low-poly player: skin head/arms/legs, team-coloured jersey + cap,
    // white shorts and shoes. (Replaces the old capsule.)
    const skin = new THREE.MeshStandardMaterial({ color: 0xf2c9a0, roughness: 0.85 });
    const jersey = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
    const white = new THREE.MeshStandardMaterial({ color: 0xeef2f7, roughness: 0.7 });
    const part = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      x: number,
      y: number,
      z: number,
    ): THREE.Mesh => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      group.add(m);
      return m;
    };

    for (const sx of [-0.12, 0.12]) {
      part(new THREE.CylinderGeometry(0.085, 0.075, 0.72, 12), skin, sx, 0.46, 0); // leg
      part(new THREE.BoxGeometry(0.16, 0.09, 0.3), white, sx, 0.05, 0.05); // shoe
    }
    part(new THREE.BoxGeometry(0.44, 0.26, 0.3), white, 0, 0.86, 0); // shorts
    part(new THREE.CylinderGeometry(0.21, 0.27, 0.62, 16), jersey, 0, 1.2, 0); // torso
    part(new THREE.SphereGeometry(0.21, 14, 12), jersey, 0, 1.48, 0).scale.set(1, 0.5, 1); // shoulders

    part(new THREE.SphereGeometry(0.17, 18, 14), skin, 0, 1.66, 0); // head
    part(
      new THREE.SphereGeometry(0.185, 18, 14, 0, Math.PI * 2, 0, Math.PI / 2),
      jersey,
      0,
      1.71,
      0,
    ); // cap dome
    part(new THREE.BoxGeometry(0.34, 0.04, 0.16), jersey, 0, 1.69, 0.16); // cap brim

    // Racket: a real padel paddle — short grip, throat, and a solid perforated
    // teardrop face with an accent rim. Built in `racketModel`, then held out at
    // the hand inside `racket` (which the swing animation rotates).
    const racket = new THREE.Group();
    const racketModel = new THREE.Group();
    const gripMat = new THREE.MeshStandardMaterial({
      color: 0x15171c,
      roughness: 0.85,
    });

    const grip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.024, 0.15, 12),
      gripMat,
    );
    racketModel.add(grip);
    const butt = new THREE.Mesh(
      new THREE.CylinderGeometry(0.028, 0.028, 0.02, 12),
      gripMat,
    );
    butt.position.y = -0.085;
    racketModel.add(butt);

    const accent = team === "A" ? 0x1e3a8a : 0x7f1d1d;
    const throat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.032, 0.02, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5 }),
    );
    throat.position.y = 0.11;
    racketModel.add(throat);

    // Solid teardrop padel face: an extruded, beveled bat with real through-holes
    // (a teardrop outline + a grid of circular holes), not a flat round paddle.
    const faceY = 0.3;
    const W = 0.135;
    const H = 0.16;
    const shape = new THREE.Shape();
    shape.moveTo(0, -H);
    shape.bezierCurveTo(W * 0.95, -H * 0.55, W, H * 0.25, W * 0.68, H * 0.72);
    shape.bezierCurveTo(W * 0.4, H, -W * 0.4, H, -W * 0.68, H * 0.72);
    shape.bezierCurveTo(-W, H * 0.25, -W * 0.95, -H * 0.55, 0, -H);
    for (let gy = -0.07; gy <= 0.11; gy += 0.036) {
      const row = Math.round((gy + 0.07) / 0.036);
      const offx = (row % 2) * 0.018;
      for (let gx = -0.09 + offx; gx <= 0.09; gx += 0.036) {
        if (Math.hypot(gx, gy - 0.015) < 0.1) {
          const hole = new THREE.Path();
          hole.absarc(gx, gy, 0.0115, 0, Math.PI * 2, true);
          shape.holes.push(hole);
        }
      }
    }
    const depth = 0.04;
    const faceGeo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: 0.012,
      bevelSize: 0.01,
      bevelSegments: 1,
      curveSegments: 10,
    });
    faceGeo.translate(0, 0, -depth / 2);
    const face = new THREE.Mesh(
      faceGeo,
      new THREE.MeshStandardMaterial({ color, metalness: 0.3, roughness: 0.45 }),
    );
    face.position.set(0, faceY, 0);
    face.castShadow = true;
    racketModel.add(face);

    // Hold the paddle at the right hand, face toward the hitting direction.
    racketModel.position.set(0.46, PLAYER.height * 0.5, 0.12);
    racketModel.rotation.set(-0.15, 0, -0.45);
    racketModel.castShadow = true;
    racket.add(racketModel);
    g.add(racket);
    g.userData.racket = racket;

    this.scene.add(g);
    this.players.set(slot, g);
    return g;
  }

  get domElement(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /** Project a world point to CSS pixel coords for HTML overlays (name labels). */
  projectToScreen(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    return {
      x: (v.x * 0.5 + 0.5) * w,
      y: (-v.y * 0.5 + 0.5) * h,
      visible: v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1,
    };
  }

  /**
   * World-space aim direction (XZ, unit) from the player toward the point on the
   * court under the mouse pointer. Falls back to facing the net if the ray
   * misses the ground or the pointer sits on the player.
   */
  aimFromPointer(ndcX: number, ndcY: number, px: number, pz: number): Vec2 {
    const fallback: Vec2 = { x: 0, z: this.camTeam === "A" ? 1 : -1 };
    this.raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return fallback;
    const dx = hit.x - px;
    const dz = hit.z - pz;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) return fallback;
    return { x: dx / len, z: dz / len };
  }

  /** Start a racket swing animation for a slot's avatar. */
  triggerSwing(slot: Slot): void {
    this.swingStart.set(slot, performance.now());
  }

  /** Flash a red highlight on whatever caused the lost point. */
  showFault(h: FaultHighlight): void {
    const now = performance.now();
    const red = () =>
      new THREE.MeshStandardMaterial({
        color: 0xff3030,
        emissive: 0xff2020,
        emissiveIntensity: 0.9,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      });
    const add = (mesh: THREE.Mesh) => {
      this.scene.add(mesh);
      this.markers.push({ mesh, born: now, ttl: 1900 });
    };
    const ringAt = (x: number, z: number) => {
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.1, 12, 32), red());
      r.rotation.x = -Math.PI / 2;
      r.position.set(x, 0.07, z);
      add(r);
    };

    let pos = h.pos;
    if (h.kind === "player" && h.slot) {
      const g = this.players.get(h.slot);
      if (g) pos = { x: g.position.x, y: 0, z: g.position.z };
    }

    if (h.kind === "ground" || h.kind === "out" || h.kind === "player") {
      if (pos) ringAt(pos.x, pos.z);
    } else if (h.kind === "wall" && pos) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.32, 16, 12), red());
      s.position.set(pos.x, Math.max(0.4, pos.y), pos.z);
      add(s);
      ringAt(pos.x, pos.z);
    } else if (h.kind === "net") {
      const w = this.court?.width ?? 10;
      const nh = this.court?.netHeight ?? 0.88;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w, nh), red());
      p.position.set(0, nh / 2, 0);
      add(p);
    }
  }

  private updateMarkers(now: number): void {
    for (let i = this.markers.length - 1; i >= 0; i--) {
      const m = this.markers[i]!;
      const t = (now - m.born) / m.ttl;
      if (t >= 1) {
        this.scene.remove(m.mesh);
        m.mesh.geometry.dispose();
        (m.mesh.material as THREE.Material).dispose();
        this.markers.splice(i, 1);
        continue;
      }
      (m.mesh.material as THREE.MeshStandardMaterial).opacity = 0.9 * (1 - t);
      m.mesh.scale.setScalar(1 + t * 0.7);
    }
  }

  private updateSwings(now: number): void {
    const DURATION = 320;
    const AMP = 1.7;
    for (const [slot, group] of this.players) {
      const racket = group.userData.racket as THREE.Group | undefined;
      if (!racket) continue;
      const start = this.swingStart.get(slot);
      if (start === undefined) continue;
      const p = (now - start) / DURATION;
      if (p >= 1) {
        racket.rotation.set(0, 0, 0);
        this.swingStart.delete(slot);
        continue;
      }
      // Sweep the racket across the front (+AMP → −AMP) with a forward dip.
      racket.rotation.y = AMP * Math.cos(p * Math.PI);
      racket.rotation.x = -0.5 * Math.sin(p * Math.PI);
    }
  }

  setSpectatorCamera(): void {
    this.cameraMode = "spectator";
    this.camPos.set(0, 16, 24);
    this.camLook.set(0, 1, 0);
  }

  setPlayerCamera(team: Team): void {
    this.cameraMode = "player";
    this.camTeam = team;
  }

  /** In player mode, place the camera behind the player (away from the net),
   *  looking toward the net. Derived from the player's z-side so it stays correct
   *  after an ends-swap. */
  focusCamera(x: number, _y: number, z: number): void {
    if (this.cameraMode !== "player") return;
    const s = z < 0 ? -1 : 1; // which end the player is on
    this.camPos.set(x * 0.5, 6.5, z + s * 10);
    this.camLook.set(x * 0.35, 1.4, z - s * 6);
  }

  setBall(x: number, y: number, z: number): void {
    this.ball.position.set(x, y, z);
  }

  setPlayer(slot: Slot, x: number, y: number, z: number, yaw: number): void {
    const g = this.avatar(slot);
    g.position.set(x, y, z);
    g.rotation.y = yaw;
  }

  removePlayer(slot: Slot): void {
    const g = this.players.get(slot);
    if (g) {
      this.scene.remove(g);
      this.players.delete(slot);
    }
  }

  private onResize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    // updateStyle=true: set the canvas CSS size to the window size while the
    // drawing buffer scales by devicePixelRatio. Without this, the canvas is
    // displayed at buffer size (2× on Retina) and only a corner is visible.
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  render(): void {
    const now = performance.now();
    this.updateSwings(now);
    this.updateMarkers(now);
    // Smoothly ease the camera toward its target pose.
    this.camera.position.lerp(this.camPos, 0.12);
    this.camera.lookAt(this.camLook);
    this.renderer.render(this.scene, this.camera);
  }

  start(frame: (dt: number) => void): void {
    let last = performance.now();
    this.renderer.setAnimationLoop(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      frame(dt);
      this.render();
    });
  }
}
