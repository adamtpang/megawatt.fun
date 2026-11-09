# House models

The ROI page loads one glTF binary per home preset:

| Preset | File | About |
| --- | --- | --- |
| Small bungalow | `/models/house-bungalow.glb` | One story, porch, about 10 m across |
| 2-story suburban | `/models/house-suburban.glb` | Two stories plus a garage, about 18 m wide |
| Large ranch | `/models/house-ranch.glb` | Long house plus a wing, about 21 m wide |

`house-scene.js` loads that path with three.js `GLTFLoader`. The file is kept in meters. The camera moves back so each house fills the frame. The page does not rescale the model.

## Convention

- Units are meters. 1 glTF unit is 1 meter.
- Up axis is Y. The Blender file is Z-up. The exporter writes Y-up.
- Origin is the ground center of the wall footprint. The ground plane is y = 0. The house sits on that plane.
- The front of the house faces +Z.
- The wall cabinet is a mesh named `Battery`. The page tints that mesh green while the price clock is charging and orange while it is discharging. `BatteryBand` and `BatteryPad` stay put.
- Flat colors only. No commercial textures.

The page also colors the ground from the result: green when the battery pays back and NPV is at least zero, gold when it pays back but NPV is negative, red when it does not pay back. That color is not the only signal. The numbers sit beside the model, and a caption states the payback in words.

If WebGL is missing, the model fails to load, or the network blocks the three.js module, the page keeps the flat drawing. `prefers-reduced-motion` shows one still frame and does not step through the price day.

## Regenerate

The files in `models/` were built in Blender 5.2.3 by `scripts/blender/build_houses.py`.

```
blender --background --factory-startup --python scripts/blender/build_houses.py -- models
```

That writes the three `models/house-<preset>.glb` files. The `--` is required so Blender passes `models` through to the script.

Blender MCP on a local PC can open those files and keep editing them. Export again with the same convention: Y-up, meters, origin at the ground center of the wall footprint, front facing +Z, the cabinet named `Battery`.
