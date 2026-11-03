"""Run inside isolated Helium Harness; captures the real page frame by frame.
PowerShell: Get-Content scripts/record-ops.py -Raw | helium-agent --profile megawatt-design run
Requires the local preview on :8765 and ffmpeg on PATH. No uploads or audio capture.
"""
import base64
import json
import os
import shutil
import subprocess
from pathlib import Path

root = Path(os.environ['MEGAWATT_ROOT']).resolve()
out = root / 'demo/deployment-ops/deployment-ops-demo.mp4'
ffmpeg = shutil.which('ffmpeg')
if not ffmpeg:
    raise RuntimeError('Install ffmpeg or add it to PATH before recording.')
out.parent.mkdir(parents=True, exist_ok=True)
new_tab('http://127.0.0.1:8765/ops?film=1')
cdp('Page.bringToFront')
wait_for_load()
cdp('Emulation.setDeviceMetricsOverride', width=1920, height=1080, deviceScaleFactor=1, mobile=False)
js('document.fonts.ready.then(() => true)')
assert js('window.opsStudy.getState().ready'), '3D renderer did not initialize'
fps, seconds = 24, 36
cmd = [ffmpeg, '-y', '-hide_banner', '-loglevel', 'error', '-f', 'image2pipe', '-vcodec', 'mjpeg',
       '-framerate', str(fps), '-i', 'pipe:0', '-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
       '-pix_fmt', 'yuv420p', '-movflags', '+faststart', str(out)]
log = out.with_suffix('.encode.log')
with log.open('wb') as errors:
    encoder = subprocess.Popen(cmd, stdin=subprocess.PIPE, stderr=errors,
                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    try:
        for frame in range(fps * seconds):
            result = js(f'window.opsFilm.frame({frame / fps})')
            if frame in (0, 8 * fps, 20 * fps):
                print(json.dumps(result), flush=True)
            capture = cdp('Page.captureScreenshot', format='jpeg', quality=90)
            encoder.stdin.write(base64.b64decode(capture['data']))
            if frame % (fps * 6) == 0:
                print(f'Recorded {frame}/{fps * seconds} frames', flush=True)
    finally:
        encoder.stdin.close()
        encoder.wait()
if encoder.returncode:
    raise RuntimeError(f'Encoding failed; inspect {log}')
print(f'Saved {out} ({out.stat().st_size} bytes)', flush=True)
