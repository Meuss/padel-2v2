# player.glb

Realistic padel players: one body and four heads (`Head_0`…`Head_3`, one per seat: A1, A2,
B1, B2) skinned onto one animation rig, with motion-captured strokes. About 2.3 MB; each
player shows about 7.5k triangles.

## Sources and licences

| Part | Source | Licence |
|---|---|---|
| Body, kit and `Head_0` | Microsoft Rocketbox `Professions/Sports_Male_04` | MIT (notice below) |
| `Head_1`, `Head_2`, `Head_3` | Microsoft Rocketbox `Adults/Male_Adult_16`, `_10`, `_12` | MIT (notice below) |
| Rig, locomotion and dance clips | Quaternius, Universal Animation Library [Standard] | CC0 1.0 |
| `Drive` and `Smash` clips | Tennis-MoCap, player `jarua`: `jarua_Derecha_18seg.bvh`, `jarua_Remate.bvh` | CC BY-SA 3.0 |

- Rocketbox: https://github.com/microsoft/Microsoft-Rocketbox (the `Assets/Avatars/.../Export/<Name>.fbx`
  files and their `Textures/*.tga`).
- Universal Animation Library: https://quaternius.com/packs/universalanimationlibrary.html, download
  https://opengameart.org/sites/default/files/universal_animation_librarystandard.zip
  (`Godot/AnimationLibrary_Godot_Standard.glb`).
- Tennis-MoCap: https://github.com/jdpulgarin/Tennis-MoCap (`data/`).

### Tennis-MoCap attribution (CC BY-SA 3.0)

The `Drive` and `Smash` clips are adapted from the Tennis-MoCap dataset by Juan Diego
Pulgarin-Giraldo, Sergio Garcia-Vega, Luis Gerardo Melo-Betancourt, Santiago Ramos-Bermudez,
Andres Marino Alvarez-Meza and German Castellanos, licensed under
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). Changes: one stroke cut
around ball contact, retargeted to the upper body of the rig. These two clips, as adapted,
are shared under the same licence.

Pulgarin-Giraldo J.D., Alvarez-Meza A.M., Melo-Betancourt L.G., Ramos-Bermudez S.,
Castellanos-Dominguez G. *A Similarity Indicator for Differentiating Kinematic Performance
Between Qualified Tennis Players.* LNCS 10125, pp. 309–317, 2017.
https://doi.org/10.1007/978-3-319-52277-7_38

### Microsoft Rocketbox licence

```
MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Rebuilding

Put each Rocketbox avatar in its own folder (its `Export/<Name>.fbx` next to its `Textures/*.tga`),
then (macOS: textures go through `sips`):

```bash
node scripts/build-player-model.mjs \
  --drive <tennis-mocap>/data/jarua_Derecha_18seg.bvh \
  --smash <tennis-mocap>/data/jarua_Remate.bvh \
  "<ual>/Godot/AnimationLibrary_Godot_Standard.glb" \
  packages/client/public/models/player.glb \
  <rocketbox>/Sports_Male_04 <rocketbox>/Male_Adult_16 <rocketbox>/Male_Adult_10 <rocketbox>/Male_Adult_12
```

What the script does (details in its header comment):

- Fits the UAL skeleton onto the Rocketbox (3ds Max Biped) joints and binds the Rocketbox
  meshes to it, so the UAL clips (`Idle_Loop`, `Jog_Fwd_Loop`,
  `Sprint_Loop`, `Dance_Loop`, `Jump_Start`) play unchanged.
- Keeps the body of the first avatar and the head of every avatar. A borrowed head also gets
  the body avatar's upper-chest skin patch, tinted to its skin, and its collar is
  remapped to neck skin. Each head carries `extras.skinTint`, which the client applies to the
  body's arms and legs.
- Cuts one forehand and one smash from the mocap around ball contact and retargets them
  (spine and arms only).
- Textures: colour 1024 px JPEG, normals 512 px, hair cards 512 px PNG with alpha.

The client recolours the shirt (the body texture's only blue) to the team colour in a shader;
see `tintKit` in `src/world/avatar.ts`.
