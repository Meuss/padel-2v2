// Trims the Quaternius Universal Animation Library mannequin to the clips the game uses.
// Usage: node scripts/prepare-player-model.mjs <input.glb> <output.glb>
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { statSync } from 'node:fs';

const KEEP = [
  'Idle_Loop',
  'Crouch_Idle_Loop',
  'Jog_Fwd_Loop',
  'Sprint_Loop',
  'Sword_Attack',
  'Punch_Cross',
  'Dance_Loop',
  'Jump_Start',
];

const [input, output] = process.argv.slice(2);
if (!input || !output) {
  console.error('Usage: node scripts/prepare-player-model.mjs <input.glb> <output.glb>');
  process.exit(1);
}

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

const missing = KEEP.filter((n) => !root.listAnimations().some((a) => a.getName() === n));
if (missing.length > 0) {
  console.error(`Missing clips: ${missing.join(', ')}`);
  process.exit(1);
}
for (const anim of root.listAnimations()) {
  if (KEEP.includes(anim.getName())) continue;
  // Dispose channels and samplers too, otherwise their accessors stay alive and get written.
  for (const channel of anim.listChannels()) channel.dispose();
  for (const sampler of anim.listSamplers()) sampler.dispose();
  anim.dispose();
}

await doc.transform(dedup(), prune(), quantize());
await io.write(output, doc);

let triangles = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const idx = prim.getIndices();
    const pos = prim.getAttribute('POSITION');
    triangles += (idx ? idx.getCount() : (pos?.getCount() ?? 0)) / 3;
  }
}

console.log(`bytes: ${statSync(output).size}`);
console.log(`clips: ${root.listAnimations().map((a) => a.getName()).join(', ')}`);
console.log(`triangles: ${triangles}`);
