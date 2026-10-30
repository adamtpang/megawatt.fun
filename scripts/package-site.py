"""Build an allowlisted public deployment; never upload the working checkout."""
from pathlib import Path
import shutil
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PUBLIC_FILES = [
    "assets/fonts/PPNeueMontreal-Regular.woff2", "assets/fonts/PPNeueMontreal-Medium.woff2",
    "assets/fonts/PPNeueMontreal-SemiBold.woff2",
    "deploy.html", "deploy.css", "deploy.js", "deployment-core.js", "api/franklin.js",
    "market-intelligence.js", "candidate-scoring.js", "market-intelligence.d.ts", "deployment-core.d.ts",
    "ops.html", "ops.css", "ops.js", "ops-core.js",
    "vendor/airsup/des.js", "vendor/airsup/three.bundle.js", "vendor/airsup/LICENSE", "vendor/airsup/LICENSE-three.txt", "vendor/airsup/NOTICE.md",
    "demo/deployment-ops/README.md", "demo/deployment-ops/results.json",
    "demo/texas-deployment/market-summary.json",
    "data/deployment/prices.json", "data/deployment/sites.json", "data/deployment/manifest.json",
    "data/deployment/texas-counties.geojson", "data/deployment/LZ_HOUSTON.csv",
    "data/deployment/LZ_NORTH.csv", "data/deployment/LZ_SOUTH.csv",
    "demo/texas-deployment/README.md", "demo/texas-deployment/METHOD.md", "demo/texas-deployment/VALIDATION.md",
    "demo/texas-deployment/results.json", "demo/texas-deployment/monthly.csv",
    "favicon.ico", "index.html", "tools.html", "live.html", "kardashev.html", "titans.html",
    "style.css", "climb.css", "climb.js", "vercel.json", "api/prices.js",
    "data/kardashev-baseline.json", "scorecard.css",
    "data/progress-scorecard.json", "data/progress-scorecard.csv",
    "guide.css", "site.css", "guide.js", "levelup.js", "earth.js", "explain.js",
    "base.html", "base.css", "base.js", "base-core.js", "roadmap.html",
    "essay.html", "why.html", "sources.html", "about.html", "contact.html", "privacy.html",
    "data/ercot-dam-houston.json", "data/energy-gdp.json", "data/build-assumptions.json",
    "data/ercot-dam-hubavg-2026-08-13.csv",
    "robots.txt", "sitemap.xml", "llms.txt", "essay/kardashev-073.png",
    "bench.html", "bench.css", "bench.js", "dispatch-bench-core.js", "restart-evidence.js",
    "docs/design-system.md", "docs/base-design-reference.json",
    "demo/dispatch-bench/README.md", "demo/dispatch-bench/results.json",
    "demo/dispatch-bench/results.csv", "demo/dispatch-bench/guarded-trace.csv",
    "demo/dispatch-bench/RESTARTS.md", "demo/dispatch-bench/restart-results.json",
    "demo/dispatch-bench/restart_fixture.py",
    "demo/dispatch-study/DEMO.md",
    "demo/dispatch-study/results/summary.csv",
    "demo/dispatch-study/results/daily.csv",
    "demo/dispatch-study/results/inputs.csv",
    "demo/dispatch-study/results/trace.csv",
    "demo/dispatch-study/results/manifest.txt",
]
PUBLIC_FILES += [f"data/deployment/{point}.csv" for point in [
    "HB_BUSAVG", "HB_HOUSTON", "HB_HUBAVG", "HB_NORTH", "HB_PAN", "HB_SOUTH", "HB_WEST",
    "LZ_AEN", "LZ_CPS", "LZ_LCRA", "LZ_RAYBN", "LZ_WEST",
]]
SOURCE_FILES = [
    "go.mod", "main.go", "data/ercot-dam-hubavg-2026-08-13.csv",
    "dispatch/dispatch.go", "dispatch/dispatch_test.go",
    "dispatch/replay.go", "dispatch/replay_test.go",
    "dispatch/capex.go", "dispatch/capex_test.go",
    "ercot/fetch.go", "ercot/fetch_test.go",
    "cmd/dispatch-study/main.go", "cmd/dispatch-study/main_test.go",
]
BENCH_SOURCE_FILES = [
    "assets/fonts/PPNeueMontreal-Regular.woff2", "assets/fonts/PPNeueMontreal-Medium.woff2",
    "assets/fonts/PPNeueMontreal-SemiBold.woff2",
    "bench.html", "bench.css", "bench.js", "dispatch-bench-core.js", "base-core.js",
    "guide.css", "site.css", "data/ercot-dam-houston.json", "tests/bench.test.cjs",
    "tests/base.test.cjs", "scripts/replay-bench.cjs", "demo/dispatch-bench/README.md",
    "restart-evidence.js", "demo/dispatch-bench/restart_fixture.py",
    "demo/dispatch-bench/RESTARTS.md", "demo/dispatch-bench/restart-results.json",
    "tests/test_restart_fixture.py",
]
DEPLOY_SOURCE_FILES = [
    name for name in PUBLIC_FILES
    if name.startswith(("data/deployment/", "demo/texas-deployment/", "assets/fonts/"))
] + [
    "deploy.html", "deploy.css", "deploy.js", "deployment-core.js", "site.css",
    "api/franklin.js", "favicon.ico", "scripts/serve.py", "scripts/ingest-deployment.py",
    "scripts/replay-deployment.cjs", "tests/deployment.test.cjs", "tests/franklin.test.cjs",
    "market-intelligence.js", "candidate-scoring.js", "market-intelligence.d.ts", "deployment-core.d.ts",
    "scripts/ercot_prices.py", "scripts/requirements-market.txt",
    "tests/market-intelligence.test.cjs", "tests/test_ercot_prices.py", "tests/market-types.ts",
    "ops.html", "ops.css", "ops.js", "ops-core.js", "tests/ops.test.cjs", "scripts/replay-ops.cjs", "scripts/record-ops.py",
    "vendor/airsup/des.js", "vendor/airsup/three.bundle.js", "vendor/airsup/LICENSE", "vendor/airsup/LICENSE-three.txt", "vendor/airsup/NOTICE.md",
    "demo/deployment-ops/README.md", "demo/deployment-ops/results.json",
]


def package():
    staging = ROOT / ".vercel" / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    out = Path(tempfile.mkdtemp(prefix="public-", dir=staging))
    for name in PUBLIC_FILES:
        target = out / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / name, target)
    # The internal README links an application draft. Only its technical study
    # is public; keep career material and session records out of all uploads.
    readme = (ROOT / "demo/dispatch-study/README.md").read_text(encoding="utf-8-sig")
    readme = readme.split("See [official-source relevance and application draft]")[0].rstrip()
    readme += "\n\nIndependent study; not affiliated with Base Power. Uses no proprietary data.\n"
    (out / "demo/dispatch-study/README.md").write_text(readme, encoding="utf-8")
    with zipfile.ZipFile(out / "demo/dispatch-study/source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in SOURCE_FILES:
            archive.write(ROOT / name, name)
        archive.writestr("README.md", "# Megawatt dispatch study\n\nRun `go test ./...` and `go run ./cmd/dispatch-study`.\n\nRead [the study](demo/dispatch-study/README.md). Results are generated under demo/dispatch-study/results/.\n")
        archive.writestr("demo/dispatch-study/README.md", readme)
        archive.write(ROOT / "demo/dispatch-study/DEMO.md", "demo/dispatch-study/DEMO.md")
    with zipfile.ZipFile(out / "demo/dispatch-bench/source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in BENCH_SOURCE_FILES:
            archive.write(ROOT / name, name)
    with zipfile.ZipFile(out / "demo/texas-deployment/source.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        for name in DEPLOY_SOURCE_FILES:
            archive.write(ROOT / name, name)
        archive.writestr("README.md", "# Megawatt deployment study\n\nStart with demo/texas-deployment/README.md. Run `python scripts/serve.py`, then open http://127.0.0.1:8765/deploy.\n\nThis focused archive includes the tool, cached inputs, ingestion, replay and tests. Navigation to other Megawatt pages requires the full site. No credentials or paid calls needed.\n")
    (out / ".vercel").mkdir()
    shutil.copyfile(ROOT / ".vercel/project.json", out / ".vercel/project.json")
    expected = set(PUBLIC_FILES) | {"demo/dispatch-study/README.md", "demo/dispatch-study/source.zip", "demo/dispatch-bench/source.zip", "demo/texas-deployment/source.zip", ".vercel/project.json"}
    actual = {p.relative_to(out).as_posix() for p in out.rglob("*") if p.is_file()}
    assert actual == expected, (actual - expected, expected - actual)
    for name in actual:
        assert not any(word in name.lower() for word in ["application", "continue_from", "interviews", "agents.md", ".env"])
    print(out)
    print(f"Verified {len(actual)} allowlisted files; private notes excluded.")
    return out


if __name__ == "__main__":
    package()
