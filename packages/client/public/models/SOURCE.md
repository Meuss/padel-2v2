# player.glb

- Origin: Universal Animation Library [Standard] by Quaternius
- Download: https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
- Pack page: https://quaternius.com/packs/universalanimationlibrary.html
- Licence: CC0 1.0 Universal (public domain dedication), as stated in the pack's License.txt
- Source file: `Godot/AnimationLibrary_Godot_Standard.glb` from the zip (not committed)

## Processing

```bash
node scripts/prepare-player-model.mjs "<unzipped>/Godot/AnimationLibrary_Godot_Standard.glb" packages/client/public/models/player.glb
```

Keeps only these clips: `Idle_Loop`, `Crouch_Idle_Loop`, `Jog_Fwd_Loop`, `Sprint_Loop`,
`Sword_Attack`, `Punch_Cross`, `Dance_Loop`, `Jump_Start`. Then `dedup`, `prune`, `quantize`.

Compression: `KHR_mesh_quantization` only (no meshopt), so three's plain `GLTFLoader`
loads it without a `MeshoptDecoder`. Size about 1.3 MB.
