"""Track the upstream contracts Flow consumes; never execute upstream code.

--update REPO records current source hashes. --accept records operator-reviewed
hashes after adapting Flow and passing its regression tests. Default: check.
"""

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "contracts/babylon.json"
PATHS = [
    "client/python/babylon_async/src/babylon_async/catalogitem.py",
    "client/python/babylon_async/src/babylon_async/agnosticvcomponent.py",
    "workshop-manager/operator/workshopprovision.py",
    "workshop-manager/operator/workshop.py",
    "tenant-cluster-pool-manager/operator/operator.py",
    "client/python/babylon_async/src/babylon_async/tenantclusterpool.py",
    "helm/crds/catalogitems.babylon.gpte.redhat.com.yaml",
    "helm/crds/workshopprovisions.babylon.gpte.redhat.com.yaml",
    "helm/crds/tenantclusterpools.babylon.gpte.redhat.com.yaml",
]


def check(manifest):
    changed = sorted(
        path for path in set(manifest["observed"]) | set(manifest["reviewed"])
        if manifest["observed"].get(path) != manifest["reviewed"].get(path)
    )
    for path in changed:
        print(f"Contract review required: {path}")
    return not changed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--update", type=Path)
    parser.add_argument("--accept", action="store_true")
    args = parser.parse_args()
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {"reviewed": {}}
    if args.update:
        observed = {
            path: hashlib.sha256((args.update / path).read_bytes()).hexdigest()
            for path in PATHS
        }
        # Ignore unrelated Babylon commits so they do not generate empty PRs.
        if observed != manifest.get("observed"):
            manifest["observed"] = observed
            manifest["commit"] = subprocess.check_output(
                ["git", "-C", str(args.update), "rev-parse", "HEAD"], text=True,
            ).strip()
    if args.accept:
        manifest["reviewed"] = dict(manifest["observed"])
    if args.update or args.accept:
        MANIFEST.parent.mkdir(exist_ok=True)
        MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")
    return 0 if check(manifest) else 1


if __name__ == "__main__":
    raise SystemExit(main())
