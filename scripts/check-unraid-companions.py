#!/usr/bin/env python3
"""Compare published companion templates with the bundled operator contract."""

import argparse
import http.client
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET

COMPANIONS = {
    "personal": (
        "iuliandita/unraid-templates",
        "https://raw.githubusercontent.com/iuliandita/unraid-templates/main/digarr.xml",
    ),
    "community": (
        "selfhosters/unRAID-CA-templates",
        "https://raw.githubusercontent.com/selfhosters/unRAID-CA-templates/master/templates/digarr.xml",
    ),
}
IGNORED = {"Repository", "Branch"}
LIMIT = 1_048_576


def contract(data: bytes) -> dict[str, object]:
    root = ET.fromstring(data)
    if root.tag != "Container":
        raise ValueError("expected a Container template")
    result: dict[str, object] = {}
    for element in root:
        if element.tag in IGNORED:
            continue
        key = element.tag
        if key == "Config":
            key = f"Config:{element.get('Type')}:{element.get('Target')}"
        if key in result:
            raise ValueError(f"duplicate template field: {key}")
        result[key] = {
            "attributes": dict(sorted(element.attrib.items())),
            "value": " ".join((element.text or "").split()),
        }
    if not any(key.startswith("Config:") for key in result):
        raise ValueError("template has no configuration fields")
    return result


def retrieve(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "digarr-template-check"})
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("template exceeds the 1 MiB limit")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundled", type=Path, default=Path("deploy/unraid/digarr.xml"))
    parser.add_argument("--personal", type=Path, help="compare a local fixture instead of fetching")
    parser.add_argument("--community", type=Path, help="compare a local fixture instead of fetching")
    parser.add_argument("--format", choices=["json", "markdown"], default="json")
    args = parser.parse_args()
    try:
        expected = contract(args.bundled.read_bytes())
    except (OSError, ValueError, ET.ParseError) as error:
        print(f"Bundled template cannot be checked: {error}", file=sys.stderr)
        return 2
    reports = []
    status = 0
    for name, (repo, url) in COMPANIONS.items():
        try:
            fixture = getattr(args, name)
            actual = contract(fixture.read_bytes() if fixture else retrieve(url))
            differences = [
                key for key in sorted(expected.keys() | actual.keys())
                if expected.get(key) != actual.get(key)
            ]
            reports.append({"repo": repo, "status": "different" if differences else "aligned",
                            "differences": differences})
            status = max(status, int(bool(differences)))
        except (OSError, ValueError, ET.ParseError, urllib.error.URLError, http.client.HTTPException) as error:
            reports.append({"repo": repo, "status": "unavailable", "error": str(error)})
            status = 2
    if args.format == "json":
        print(json.dumps({"intentional_difference": "Companions track latest; bundled pins a release.",
                          "companions": reports}, indent=2))
    else:
        print("## Unraid companion templates\n")
        print("Release tags and digest comments are intentionally excluded. This is an advisory check.\n")
        for report in reports:
            repo = report["repo"]
            print(f"- [{repo}](https://github.com/{repo}): {report['status']}")
            for field in report.get("differences", []):
                print(f"  - `{field}` differs")
            if "error" in report:
                print(f"  - Retrieval failed: {report['error']}")
        print("\nCheck pending companion PRs before opening duplicate work. See docs/MAINTENANCE.md.")
    return status


if __name__ == "__main__":
    raise SystemExit(main())
