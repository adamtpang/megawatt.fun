# House models

The ROI page loads one glTF binary per home preset:

| Preset | File |
| --- | --- |
| Small bungalow | `/models/house-bungalow.glb` |
| 2-story suburban | `/models/house-suburban.glb` |
| Large ranch | `/models/house-ranch.glb` |

`house-scene.js` asks three.js `GLTFLoader` for that path. The files in the repo are placeholders from `node scripts/build-house-glb.js`. Replace them with Blender exports that follow the same convention. The page does not need a code change when the file changes.

## Convention

- Units are meters. 1 glTF unit is 1 meter.
- Up axis is Y. glTF is Y-up. Blender's exporter converts from Blender's Z-up if you leave the default on.
- Origin is the ground center of the house footprint. The ground plane is y = 0. The house should sit on that plane, not float and not sink.
- The front of the house faces +Z.
- Scale is real-world. A one-story house is about 3 meters to the eaves. Do not export a centimeter model (that is 100 times too small) or a model in inches.
- Apply transforms in Blender before export (Object > Apply > All Transforms) so translation, rotation and scale are not left on a parent empty.
- Name the battery object `Battery`. The page tints that node: green while the clock is charging, orange while it is discharging. Any mesh under a node of that name is found.
- Keep the file under a few megabytes. No embedded commercial textures from another brand. A flat color is enough.

The page also draws a ground color from the result: green when the battery pays back and NPV is at least zero, gold when it pays back but NPV is negative, red when it does not pay back. That color is not the only signal. The numbers sit beside the model, and a caption states the payback in words.

If WebGL is missing, the model fails to load, or the network blocks the three.js module, the page keeps the flat drawing. `prefers-reduced-motion` shows one still frame and does not spin the house or step through the price day.
