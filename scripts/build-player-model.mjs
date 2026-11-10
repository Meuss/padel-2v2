// Builds packages/client/public/models/player.glb: Microsoft Rocketbox avatars (MIT) skinned
// onto the Quaternius Universal Animation Library rig (CC0), so the UAL clips drive them unchanged.
//
// Usage:
//   node scripts/build-player-model.mjs <ual.glb> <output.glb> <body-avatar-dir> [<head-avatar-dir>...]
//
// <ual.glb>          `Godot/AnimationLibrary_Godot_Standard.glb` from the UAL [Standard] zip.
// <*-avatar-dir>     One Rocketbox avatar: `<Name>.fbx` (the `Export/` file, not `_facial`) next to
//                    its `Textures/*.tga`. The body comes from the first; the output holds one head
//                    per avatar dir (`Head_0` is the body avatar's own), for the client to pick from.
//                    Body dir: `*_body_color`, `*_body_normal`, `*_head_color`, `*_head_normal`.
//                    Head dirs: `*_head_color`, `*_head_normal`, and `*_opacity_color` if it has hair cards.
//
// How: the UAL skeleton is fitted to the avatar. Every UAL bone is moved onto the matching
// Rocketbox (3ds Max Biped) joint and swung so it points at the same child joint; the meshes
// are then bound to that fitted skeleton in their own A-pose, with each Biped weight moved to
// the matching UAL bone. The clips keep only rotations (plus the root and hips translation,
// scaled to the new hip height), so the avatar's own bone lengths hold. Rocketbox adults share
// one skeleton, so any adult male head sits on the body's neck.
//
// Each head node carries `extras.skinTint`: its face's skin colour over the body avatar's own
// face (linear RGB), so the client can tint arms and legs to match.
//
// Textures are resized with macOS `sips`.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize, weld } from '@gltf-transform/functions';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// three's loaders parse in Node with a stub DOM (images are never decoded here).
const stub = () => ({ addEventListener() {}, removeEventListener() {}, setAttribute() {}, style: {} });
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: stub, createElement: stub };
// three is a client dependency; load it from there (its loaders import 'three' themselves).
const threeDir = new URL('../packages/client/node_modules/three/', import.meta.url);
const THREE = await import(new URL('build/three.module.js', threeDir).href);
const { FBXLoader } = await import(new URL('examples/jsm/loaders/FBXLoader.js', threeDir).href);
const { GLTFLoader } = await import(new URL('examples/jsm/loaders/GLTFLoader.js', threeDir).href);
const { BVHLoader } = await import(new URL('examples/jsm/loaders/BVHLoader.js', threeDir).href);

const KEEP = ['Idle_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Dance_Loop', 'Jump_Start'];
const TEXTURE_PX = 1024;
const HAIR_TEXTURE_PX = 512;
const NORMAL_TEXTURE_PX = 512;

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  if (i < 0) return null;
  const [, value] = args.splice(i, 2);
  return value;
};
const strokeFiles = { Drive: flag('--drive'), Smash: flag('--smash') };
const [ualPath, output, rbDir, ...headDirs] = args;
if (!ualPath || !output || !rbDir || !strokeFiles.Drive || !strokeFiles.Smash) {
  console.error(
    'Usage: node scripts/build-player-model.mjs --drive <forehand.bvh> --smash <smash.bvh> <ual.glb> <output.glb> <body-avatar-dir> [<head-avatar-dir>...]',
  );
  process.exit(1);
}

// ── Bone correspondence ─────────────────────────────────────────────────────
// UAL bone (glTF name) → [Biped joint, Biped joint it points at (null: keep the parent's swing)].
const FIT = { 'DEF-hips': ['Pelvis', 'Spine'], 'DEF-spine.001': ['Spine', 'Spine1'], 'DEF-spine.002': ['Spine1', 'Spine2'], 'DEF-spine.003': ['Spine2', 'Neck'], 'DEF-neck': ['Neck', 'Head'], 'DEF-head': ['Head', null] };
/** UAL child each fitted bone points at, mirroring FIT's second column. */
const AIM = { 'DEF-hips': 'DEF-spine.001', 'DEF-spine.001': 'DEF-spine.002', 'DEF-spine.002': 'DEF-spine.003', 'DEF-spine.003': 'DEF-neck', 'DEF-neck': 'DEF-head' };
const DIGITS = { index: 1, middle: 2, ring: 3, pinky: 4 };
for (const s of ['L', 'R']) {
  const b = (n) => `${s}_${n}`;
  Object.assign(FIT, {
    [`DEF-shoulder.${s}`]: [b('Clavicle'), b('UpperArm')],
    [`DEF-upper_arm.${s}`]: [b('UpperArm'), b('Forearm')],
    [`DEF-forearm.${s}`]: [b('Forearm'), b('Hand')],
    [`DEF-hand.${s}`]: [b('Hand'), b('Finger2')],
    [`DEF-thigh.${s}`]: [b('Thigh'), b('Calf')],
    [`DEF-shin.${s}`]: [b('Calf'), b('Foot')],
    [`DEF-foot.${s}`]: [b('Foot'), b('Toe0')],
    [`DEF-toe.${s}`]: [b('Toe0'), null],
  });
  Object.assign(AIM, {
    [`DEF-shoulder.${s}`]: `DEF-upper_arm.${s}`,
    [`DEF-upper_arm.${s}`]: `DEF-forearm.${s}`,
    [`DEF-forearm.${s}`]: `DEF-hand.${s}`,
    [`DEF-hand.${s}`]: `DEF-f_middle.01.${s}`,
    [`DEF-thigh.${s}`]: `DEF-shin.${s}`,
    [`DEF-shin.${s}`]: `DEF-foot.${s}`,
    [`DEF-foot.${s}`]: `DEF-toe.${s}`,
  });
  const digits = [...Object.entries(DIGITS).map(([d, i]) => [`DEF-f_${d}`, `Finger${i}`]), ['DEF-thumb', 'Finger0']];
  for (const [ual, bip] of digits) {
    const seg = [1, 2, 3].map((k) => `${ual}.0${k}.${s}`);
    const joint = [b(bip), b(`${bip}1`), b(`${bip}2`)];
    seg.forEach((u, k) => {
      FIT[u] = [joint[k], joint[k + 1] ?? null];
      if (seg[k + 1]) AIM[u] = seg[k + 1];
    });
  }
}
const bip = (n) => `Bip01_${n}`;

// ── Load ────────────────────────────────────────────────────────────────────
const arrayBuffer = (p) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};
function loadAvatar(dir) {
  const fbx = readdirSync(dir).find((f) => f.endsWith('.fbx') && !f.includes('_facial'));
  if (!fbx) throw new Error(`No .fbx in ${dir}`);
  const scene = new FBXLoader().parse(arrayBuffer(join(dir, fbx)), '');
  scene.updateMatrixWorld(true);
  let mesh = null;
  scene.traverse((o) => {
    if (o.isSkinnedMesh) mesh = o;
  });
  if (!mesh) throw new Error(`No skinned mesh in ${fbx}`);
  return { dir, mesh, mats: Array.isArray(mesh.material) ? mesh.material : [mesh.material] };
}
const CM = 0.01;
const body = loadAvatar(rbDir);
const rbBone = new Map(body.mesh.skeleton.bones.map((b) => [b.name, b]));
const rbJoint = (name) => {
  const b = rbBone.get(bip(name));
  if (!b) throw new Error(`Rocketbox joint ${name} missing`);
  return b.getWorldPosition(new THREE.Vector3()).multiplyScalar(CM);
};

const ual = await new GLTFLoader().parseAsync(arrayBuffer(ualPath), '');
const ualScene = ual.scene;
ualScene.updateMatrixWorld(true);
const san = (n) => THREE.PropertyBinding.sanitizeNodeName(n);
const ualBone = (name) => {
  const o = ualScene.getObjectByName(san(name));
  if (!o) throw new Error(`UAL bone ${name} missing`);
  return o;
};

// ── Fit the UAL skeleton ────────────────────────────────────────────────────
// Original UAL rest, captured before anything moves.
const restPos = new Map();
const restRot = new Map();
for (const name of Object.keys(FIT)) {
  const o = ualBone(name);
  restPos.set(name, o.getWorldPosition(new THREE.Vector3()));
  restRot.set(name, o.getWorldQuaternion(new THREE.Quaternion()));
}
const swing = new Map();
const order = [];
ualBone('DEF-hips').traverse((o) => {
  const name = Object.keys(FIT).find((n) => san(n) === o.name);
  if (name) order.push(name);
});
for (const name of order) {
  const [joint, aimJoint] = FIT[name];
  const o = ualBone(name);
  const parentName = Object.keys(FIT).find((n) => san(n) === o.parent.name);
  let delta;
  if (aimJoint && AIM[name]) {
    const from = restPos.get(AIM[name]).clone().sub(restPos.get(name)).normalize();
    const to = rbJoint(aimJoint).sub(rbJoint(joint)).normalize();
    delta = new THREE.Quaternion().setFromUnitVectors(from, to);
  } else {
    delta = parentName ? swing.get(parentName).clone() : new THREE.Quaternion();
  }
  swing.set(name, delta);
  const worldQ = delta.clone().multiply(restRot.get(name));
  const world = new THREE.Matrix4().compose(rbJoint(joint), worldQ, new THREE.Vector3(1, 1, 1));
  o.parent.updateWorldMatrix(true, false);
  const local = new THREE.Matrix4().copy(o.parent.matrixWorld).invert().multiply(world);
  local.decompose(o.position, o.quaternion, o.scale);
  o.updateMatrixWorld(true);
}
ualScene.updateMatrixWorld(true);

// ── Rebuild the glTF ────────────────────────────────────────────────────────
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(ualPath);
const root = doc.getRoot();
const buffer = root.listBuffers()[0];
const skin = root.listSkins()[0];
const joints = skin.listJoints();
const jointIndex = new Map(joints.map((j, i) => [j.getName(), i]));

// Fitted rest transforms onto the nodes, and fresh inverse bind matrices.
const ibm = new Float32Array(joints.length * 16);
joints.forEach((node, i) => {
  const o = ualBone(node.getName());
  node.setTranslation(o.position.toArray()).setRotation(o.quaternion.toArray()).setScale(o.scale.toArray());
  new THREE.Matrix4().copy(o.matrixWorld).invert().toArray(ibm, i * 16);
});
skin.getInverseBindMatrices().setArray(ibm);

// Biped bone name → UAL joint index. Anything under the head (face rig) goes to the head.
const bipToUal = new Map();
for (const [ualName, [joint]] of Object.entries(FIT)) bipToUal.set(bip(joint), jointIndex.get(ualName));
bipToUal.set('Bip01', jointIndex.get('DEF-hips'));
const headIdx = jointIndex.get('DEF-head');
const ualJointOf = (bone) => {
  let o = bone;
  while (o && !bipToUal.has(o.name)) o = o.parent;
  if (!o) throw new Error(`Bone ${bone.name} has no UAL match`);
  return bipToUal.get(o.name) ?? headIdx;
};

// ── Textures ────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), 'player-tex-'));
const tgaPath = (dir, suffix) => {
  const f = readdirSync(dir).find((n) => n.endsWith(`${suffix}.tga`));
  return f ? join(dir, f) : null;
};
const texture = (dir, suffix, px, format) => {
  const src = tgaPath(dir, suffix);
  if (!src) throw new Error(`No *${suffix}.tga in ${dir}`);
  const out = join(tmp, `${dir.split('/').pop()}-${suffix}.${format === 'png' ? 'png' : 'jpg'}`);
  const opts = format === 'png' ? ['-s', 'format', 'png'] : ['-s', 'format', 'jpeg', '-s', 'formatOptions', '82'];
  execFileSync('sips', [...opts, '-Z', String(px), src, '--out', out], { stdio: 'ignore' });
  return doc
    .createTexture(suffix)
    .setMimeType(format === 'png' ? 'image/png' : 'image/jpeg')
    .setImage(readFileSync(out))
    .setURI(out.split('/').pop());
};

/** Mean linear colour of the skin-like pixels in an uncompressed 24/32-bit TGA. */
function skinColour(file) {
  const b = readFileSync(file);
  const idLen = b[0];
  const bpp = b[16] / 8;
  const w = b.readUInt16LE(12);
  const h = b.readUInt16LE(14);
  if (b[2] !== 2) throw new Error(`${file}: only uncompressed TGA is supported`);
  const sum = [0, 0, 0];
  let n = 0;
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < w * h; i += 7) {
    const o = 18 + idLen + i * bpp;
    const r = b[o + 2] / 255;
    const g = b[o + 1] / 255;
    const bl = b[o] / 255;
    c.setRGB(r, g, bl, THREE.LinearSRGBColorSpace).getHSL(hsl, THREE.LinearSRGBColorSpace);
    // Skin: orange-ish hue, moderate saturation, not too dark (hair) or bright (specular).
    if (!(hsl.h < 0.11 && hsl.s > 0.2 && hsl.s < 0.75 && hsl.l > 0.18 && hsl.l < 0.85 && r > g && g > bl)) continue;
    sum[0] += lin(r);
    sum[1] += lin(g);
    sum[2] += lin(bl);
    n++;
  }
  return sum.map((s) => s / Math.max(1, n));
}
// Faces read warmer and darker than limbs in the same avatar's textures, so each head's tint is
// relative to the body avatar's own face: Head_0 gets exactly 1.
const ownFace = skinColour(tgaPath(rbDir, '_head_color'));

// ── Meshes ──────────────────────────────────────────────────────────────────
/** Attributes for the given vertex indices of an avatar's mesh, in metres, bound to the UAL joints. */
function attributes(avatar, verts) {
  const { mesh } = avatar;
  const g = mesh.geometry;
  const toUal = mesh.skeleton.bones.map(ualJointOf);
  const count = verts.length;
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const jnt = new Uint16Array(count * 4);
  const wgt = new Float32Array(count * 4);
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
  verts.forEach((src, i) => {
    mesh.getVertexPosition(src, v).applyMatrix4(mesh.matrixWorld).multiplyScalar(CM).toArray(pos, i * 3);
    n.fromBufferAttribute(g.attributes.normal, src).applyMatrix3(normalMatrix).normalize().toArray(nrm, i * 3);
    uv[i * 2] = g.attributes.uv.getX(src);
    uv[i * 2 + 1] = 1 - g.attributes.uv.getY(src); // three flips V on load; glTF stores it top-down
    const acc = new Map();
    for (let k = 0; k < 4; k++) {
      const w = g.attributes.skinWeight.getComponent(src, k);
      if (w <= 0) continue;
      const j = toUal[g.attributes.skinIndex.getComponent(src, k)];
      acc.set(j, (acc.get(j) ?? 0) + w);
    }
    const sorted = [...acc].sort((a, b) => b[1] - a[1]).slice(0, 4);
    const total = sorted.reduce((s, [, w]) => s + w, 0) || 1;
    sorted.forEach(([j, w], k) => {
      jnt[i * 4 + k] = j;
      wgt[i * 4 + k] = w / total;
    });
  });
  const accessor = (type, array) => doc.createAccessor().setType(type).setArray(array).setBuffer(buffer);
  return {
    POSITION: accessor('VEC3', pos),
    NORMAL: accessor('VEC3', nrm),
    TEXCOORD_0: accessor('VEC2', uv),
    JOINTS_0: accessor('VEC4', jnt),
    WEIGHTS_0: accessor('VEC4', wgt),
  };
}

/** Vertex indices of an avatar's triangles whose material name matches `re` (FBX meshes are unindexed). */
function vertsOf(avatar, re) {
  const g = avatar.mesh.geometry;
  const groups = g.groups.length ? g.groups : [{ start: 0, count: g.attributes.position.count, materialIndex: 0 }];
  const out = [];
  for (const grp of groups) {
    if (!re.test(avatar.mats[grp.materialIndex].name)) continue;
    for (let i = grp.start; i < grp.start + grp.count; i++) out.push(i);
  }
  return out;
}

const meshNode = root.listNodes().find((nd) => nd.getMesh());
const rig = meshNode.getParentNode();
const oldMesh = meshNode.getMesh();
meshNode.dispose();
oldMesh.dispose();
for (const m of root.listMaterials()) m.dispose();

const skinnedNode = (name, mesh) => {
  const node = doc.createNode(name).setMesh(mesh).setSkin(skin);
  rig.addChild(node);
  return node;
};
/**
 * A borrowed head's texture paints its own avatar's shirt collar at the base of the neck, which
 * shows inside the body's neckline. Give every vertex below NECK_SKIN_Y the UV of the nearest
 * vertex (around the neck) in the band just above it, so the collar becomes stretched neck skin.
 */
const NECK_SKIN_Y = 1.52;
const NECK_BAND = 0.015;
function skinTheNeck(attrs) {
  const pos = attrs.POSITION.getArray();
  const uv = attrs.TEXCOORD_0.getArray();
  const band = [];
  for (let i = 0; i < pos.length / 3; i++) {
    const y = pos[i * 3 + 1];
    if (y >= NECK_SKIN_Y && y < NECK_SKIN_Y + NECK_BAND) band.push(i);
  }
  if (!band.length) return;
  for (let i = 0; i < pos.length / 3; i++) {
    if (pos[i * 3 + 1] >= NECK_SKIN_Y) continue;
    let best = band[0];
    let bestD = Infinity;
    for (const j of band) {
      const d = (pos[i * 3] - pos[j * 3]) ** 2 + (pos[i * 3 + 2] - pos[j * 3 + 2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    }
    uv[i * 2] = uv[best * 2];
    uv[i * 2 + 1] = uv[best * 2 + 1];
  }
  attrs.TEXCOORD_0.setArray(uv);
}

/**
 * The body avatar's upper-chest skin inside the tank top's neckline belongs to its head mesh.
 * Heads borrowed from crew-neck avatars stop higher, so each one also gets this patch.
 */
const CHEST_PATCH_TOP_Y = 1.53;
function chestPatch(avatar) {
  const { mesh } = avatar;
  const v = new THREE.Vector3();
  const all = vertsOf(avatar, /head/i);
  const out = [];
  for (let t = 0; t < all.length; t += 3) {
    const tri = all.slice(t, t + 3);
    const high = Math.max(...tri.map((i) => mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).y * CM));
    if (high < CHEST_PATCH_TOP_Y) out.push(...tri);
  }
  return out;
}

const addPrim = (mesh, avatar, re, material, fix, only) => {
  const verts = only ?? vertsOf(avatar, re);
  if (!verts.length) return;
  const prim = doc
    .createPrimitive()
    .setMaterial(material)
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(new Uint32Array(verts.length).map((_, i) => i)).setBuffer(buffer));
  const attrs = attributes(avatar, verts);
  fix?.(attrs);
  for (const [k, a] of Object.entries(attrs)) prim.setAttribute(k, a);
  mesh.addPrimitive(prim);
};

const bodyMat = doc
  .createMaterial('M_Body')
  .setBaseColorTexture(texture(rbDir, '_body_color', TEXTURE_PX))
  .setNormalTexture(texture(rbDir, '_body_normal', NORMAL_TEXTURE_PX))
  .setRoughnessFactor(0.78)
  .setMetallicFactor(0);
const bodyMesh = doc.createMesh('Body');
addPrim(bodyMesh, body, /body/i, bodyMat);
skinnedNode('Body', bodyMesh);

[rbDir, ...headDirs].forEach((dir, i) => {
  const avatar = dir === rbDir ? body : loadAvatar(dir);
  const headMat = doc
    .createMaterial(`M_Head_${i}`)
    .setBaseColorTexture(texture(dir, '_head_color', TEXTURE_PX))
    .setNormalTexture(texture(dir, '_head_normal', NORMAL_TEXTURE_PX))
    .setRoughnessFactor(0.62)
    .setMetallicFactor(0);
  const mesh = doc.createMesh(`Head_${i}`);
  addPrim(mesh, avatar, /head/i, headMat, i > 0 ? skinTheNeck : undefined);
  if (tgaPath(dir, '_opacity_color')) {
    const hairMat = doc
      .createMaterial(`M_Hair_${i}`)
      .setBaseColorTexture(texture(dir, '_opacity_color', HAIR_TEXTURE_PX, 'png'))
      .setAlphaMode('MASK')
      .setAlphaCutoff(0.2)
      .setDoubleSided(true)
      .setRoughnessFactor(0.7)
      .setMetallicFactor(0);
    addPrim(mesh, avatar, /opacity/i, hairMat);
  }
  const face = skinColour(tgaPath(dir, '_head_color'));
  const tint = face.map((c, k) => +Math.min(2.5, Math.max(0.2, c / ownFace[k])).toFixed(3));
  if (i > 0) {
    // The patch keeps the body avatar's head texture, tinted to this face by vertex colour.
    const tinted = (attrs) => {
      const n = attrs.POSITION.getCount();
      const col = new Float32Array(n * 3);
      for (let k = 0; k < n; k++) col.set(tint, k * 3);
      attrs.COLOR_0 = doc.createAccessor().setType('VEC3').setArray(col).setBuffer(buffer);
    };
    addPrim(mesh, body, /head/i, root.listMaterials().find((m) => m.getName() === 'M_Head_0'), tinted, chestPatch(body));
  }
  skinnedNode(`Head_${i}`, mesh).setExtras({ skinTint: tint });
  console.log(`Head_${i}: ${dir.split('/').pop()} skinTint ${tint.join(', ')}`);
});

// Clips: keep KEEP; drop scale tracks and every translation track but root and hips.
const hipsScale = rbJoint('Pelvis').y / restPos.get('DEF-hips').y;
for (const anim of root.listAnimations()) {
  if (!KEEP.includes(anim.getName())) {
    for (const c of anim.listChannels()) c.dispose();
    for (const s of anim.listSamplers()) s.dispose();
    anim.dispose();
    continue;
  }
  for (const c of anim.listChannels()) {
    const target = c.getTargetNode()?.getName();
    const path = c.getTargetPath();
    const keep = path === 'rotation' || (path === 'translation' && (target === 'root' || target === 'DEF-hips'));
    if (!keep) {
      c.getSampler().dispose();
      c.dispose();
      continue;
    }
    if (path === 'translation' && target === 'DEF-hips') {
      const out = c.getSampler().getOutput().clone();
      out.setArray(out.getArray().map((x) => x * hipsScale));
      c.getSampler().setOutput(out);
    }
  }
}

// ── Strokes (Tennis-MoCap, CC BY-SA 3.0) ────────────────────────────────────
// Each BVH holds a series of the same stroke by one right-handed player. The clip is cut around
// the fastest right-wrist moment (ball contact): the swing plays from the shot event, so it
// starts just before contact. Only the upper body is written; the legs keep their locomotion.
const STROKE_BEFORE_S = 0.15;
const STROKE_AFTER_S = 0.45;
const STROKE_FPS = 30;
/**
 * UAL bone ← mocap joint. Spine bones blend from the hips to the chest. The neck and head are
 * left to locomotion: the capture's head tilts hard to the side, which reads as a stumble.
 */
const STROKE_MAP = {
  'DEF-spine.001': ['Hips', 'Chest', 1 / 3],
  'DEF-spine.002': ['Hips', 'Chest', 2 / 3],
  'DEF-spine.003': ['Chest'],
};
for (const [s, side] of [['L', 'Left'], ['R', 'Right']]) {
  STROKE_MAP[`DEF-shoulder.${s}`] = [`${side}Collar`];
  STROKE_MAP[`DEF-upper_arm.${s}`] = [`${side}Shoulder`];
  STROKE_MAP[`DEF-forearm.${s}`] = [`${side}Elbow`];
  STROKE_MAP[`DEF-hand.${s}`] = [`${side}Wrist`];
}

/**
 * How each stroke finds its contact and the net direction. A forehand's contact is its fastest
 * wrist and the player faces the net between strokes (median hips yaw). A smash is played
 * side-on and its fastest wrist is on the way down, so contact is the highest wrist near
 * that peak, and the net is where the chest faces at contact.
 */
const STROKE_STYLE = { Drive: { contact: 'fastest', facing: 'median-hips' }, Smash: { contact: 'highest', facing: 'chest' } };

function strokeClip(name, file) {
  const style = STROKE_STYLE[name];
  const { skeleton, clip } = new BVHLoader().parse(readFileSync(file, 'utf8'));
  const holder = new THREE.Object3D();
  holder.add(skeleton.bones[0]);
  const mixer = new THREE.AnimationMixer(holder);
  mixer.clipAction(clip).play();
  const joint = (n) => skeleton.bones.find((b) => b.name === n);
  const pose = (t) => {
    mixer.setTime(t);
    holder.updateMatrixWorld(true);
  };
  // Contact: the fastest right wrist. Facing: the median hips yaw over the take (the player
  // faces the net between strokes); it becomes the avatar's forward (+Z).
  const wrist = joint('RightWrist');
  const hips = joint('Hips');
  const dt = 0.01;
  let best = 0;
  let bestT = 0;
  const yaws = [];
  const prev = new THREE.Vector3();
  const cur = new THREE.Vector3();
  for (let t = 0; t < clip.duration; t += dt) {
    pose(t);
    wrist.getWorldPosition(cur);
    const speed = t > 0 ? cur.distanceTo(prev) / dt : 0;
    const edge = t > STROKE_BEFORE_S && t < clip.duration - STROKE_AFTER_S;
    if (edge && speed > best) {
      best = speed;
      bestT = t;
    }
    prev.copy(cur);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(hips.getWorldQuaternion(new THREE.Quaternion()));
    yaws.push(Math.atan2(fwd.x, fwd.z));
  }
  const yawOf = (bone) => {
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(bone.getWorldQuaternion(new THREE.Quaternion()));
    return Math.atan2(fwd.x, fwd.z);
  };
  if (style.contact === 'highest') {
    let top = -Infinity;
    const peak = bestT;
    for (let t = peak - 0.25; t <= peak + 0.05; t += dt) {
      pose(t);
      const y = wrist.getWorldPosition(cur).y;
      if (y > top) {
        top = y;
        bestT = t;
      }
    }
  }
  yaws.sort((a, b) => a - b);
  let facingYaw = yaws[yaws.length >> 1];
  if (style.facing === 'chest') {
    pose(bestT);
    facingYaw = yawOf(joint('Chest'));
  }
  const facing = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), facingYaw);
  const unface = facing.clone().invert();

  const frames = Math.round((STROKE_BEFORE_S + STROKE_AFTER_S) * STROKE_FPS) + 1;
  const times = new Float32Array(frames);
  const out = Object.fromEntries(Object.keys(STROKE_MAP).map((b) => [b, new Float32Array(frames * 4)]));
  const world = (n) => unface.clone().multiply(joint(n).getWorldQuaternion(new THREE.Quaternion()));
  for (let f = 0; f < frames; f++) {
    times[f] = f / STROKE_FPS;
    pose(bestT - STROKE_BEFORE_S + times[f]);
    // Target world = mocap world delta (its rest is all identity, a T-pose facing +Z like
    // the UAL rest) applied to the UAL rest; locals follow from the parent's target world.
    const targetWorld = new Map();
    for (const [bone, [a, b, k]] of Object.entries(STROKE_MAP)) {
      const delta = b ? world(a).slerp(world(b), k) : world(a);
      targetWorld.set(bone, delta.multiply(restRot.get(bone)));
    }
    for (const bone of Object.keys(STROKE_MAP)) {
      const parent = Object.keys(FIT).find((n) => san(n) === ualBone(bone).parent.name);
      const parentWorld = targetWorld.get(parent) ?? restRot.get(parent);
      const local = parentWorld.clone().invert().multiply(targetWorld.get(bone));
      local.toArray(out[bone], f * 4);
    }
  }
  const anim = doc.createAnimation(name);
  const input = doc.createAccessor().setType('SCALAR').setArray(times).setBuffer(buffer);
  for (const [bone, values] of Object.entries(out)) {
    const node = root.listNodes().find((nd) => nd.getName() === bone);
    const sampler = doc
      .createAnimationSampler()
      .setInput(input)
      .setOutput(doc.createAccessor().setType('VEC4').setArray(values).setBuffer(buffer))
      .setInterpolation('LINEAR');
    anim.addSampler(sampler).addChannel(doc.createAnimationChannel().setTargetNode(node).setTargetPath('rotation').setSampler(sampler));
  }
  console.log(`${name}: ${file.split('/').pop()} contact at ${bestT.toFixed(2)} s (${(best / 100).toFixed(1)} m/s)`);
}
for (const [name, file] of Object.entries(strokeFiles)) strokeClip(name, file);

await doc.transform(weld(), dedup(), prune(), quantize());
await io.write(output, doc);

let triangles = 0;
for (const m of root.listMeshes()) for (const p of m.listPrimitives()) triangles += p.getIndices().getCount() / 3;
console.log(`bytes: ${statSync(output).size}`);
console.log(`clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
console.log(`triangles: ${triangles}, hips scale: ${hipsScale.toFixed(3)}`);
