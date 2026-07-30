#!/usr/bin/env python3
"""Regenerate `docs/VULNERABILITIES.md` from `docs/vulnerabilities/VULN-*.md`.

The index is the answer key for the security demo. It is generated so that parallel
workstreams only ever add their own detail file and never edit a shared table.

    python3 scripts/generate_vuln_index.py            # write docs/VULNERABILITIES.md
    python3 scripts/generate_vuln_index.py --check     # fail if the index is stale
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
VULN_DIR = REPO_ROOT / "docs" / "vulnerabilities"
INDEX_PATH = REPO_ROOT / "docs" / "VULNERABILITIES.md"

TITLE_RE = re.compile(r"^#\s*(?P<id>VULN-\d+)\s*[—\-–:]\s*(?P<title>.+?)\s*$")
ROW_RE = re.compile(r"^\|\s*(?P<key>[^|]+?)\s*\|\s*(?P<value>.*?)\s*\|\s*$")
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3}

HEADER = """# Planted vulnerability index

<!-- GENERATED FILE — do not edit by hand.
     Run `python3 scripts/generate_vuln_index.py` after new findings land. -->

This is the answer key for the security demo track: every deliberately planted issue in this
repository, generated from the detail files in [`docs/vulnerabilities/`](vulnerabilities/).
They are **intentional** — do not fix one unless a task explicitly names it.

Severity legend: Critical > High > Medium > Low. `Location` is the sink, as recorded by the
workstream that planted the finding.
"""

FOOTER = """
## How this file is produced

`scripts/generate_vuln_index.py` parses the metadata table and title of each
`docs/vulnerabilities/VULN-*.md` file. The same parser backs the live register at
`GET /api/security/findings`, so the UI, the API and this index cannot drift apart.
"""


@dataclass
class Finding:
    id: str
    title: str
    domain: str
    severity: str
    cwe: str
    owasp: str
    location: str
    status: str
    path: Path

    @property
    def sort_key(self) -> tuple[int, str]:
        return SEVERITY_ORDER.get(self.severity.lower(), 4), self.id


def clean(value: str) -> str:
    return value.replace("`", "").replace("**", "").strip()


def parse(path: Path) -> Finding | None:
    fields: dict[str, str] = {}
    title = ""
    for line in path.read_text(encoding="utf-8").splitlines():
        match = TITLE_RE.match(line)
        if match and not title:
            fields.setdefault("id", match.group("id"))
            title = match.group("title").strip()
            continue
        row = ROW_RE.match(line)
        if not row:
            continue
        key = clean(row.group("key")).lower()
        value = clean(row.group("value"))
        if not value or value.startswith("---") or key in {"field", "value"}:
            continue
        if key.startswith("owasp"):
            fields["owasp"] = value
        elif key in {"id", "domain", "cwe", "severity", "location", "status", "title"}:
            fields[key] = value

    finding_id = fields.get("id", "")
    if not re.fullmatch(r"VULN-\d+", finding_id):
        name_match = re.match(r"(VULN-\d+)", path.stem)
        if not name_match:
            return None
        finding_id = name_match.group(1)

    return Finding(
        id=finding_id,
        title=fields.get("title") or title or finding_id,
        domain=fields.get("domain", "-"),
        severity=(fields.get("severity") or "unknown").capitalize(),
        cwe=fields.get("cwe", "-"),
        owasp=fields.get("owasp", "-"),
        location=fields.get("location", "-"),
        status=(fields.get("status") or "open").lower(),
        path=path,
    )


def collect(directory: Path = VULN_DIR) -> list[Finding]:
    if not directory.is_dir():
        return []
    findings = [f for f in (parse(p) for p in sorted(directory.glob("VULN-*.md"))) if f]
    return sorted(findings, key=lambda f: f.sort_key)


def render(findings: list[Finding]) -> str:
    lines = [HEADER, ""]
    if not findings:
        lines.append("_No findings registered yet._")
        lines.append(FOOTER)
        return "\n".join(lines) + "\n"

    counts: dict[str, int] = {}
    for finding in findings:
        counts[finding.severity] = counts.get(finding.severity, 0) + 1
    summary = " · ".join(
        f"{severity}: {counts[severity]}"
        for severity in ("Critical", "High", "Medium", "Low", "Unknown")
        if severity in counts
    )
    lines.append(f"**{len(findings)} findings** — {summary}")
    lines.append("")
    lines.append("| ID | Title | Domain | Severity | CWE | OWASP | Location | Detail |")
    lines.append("|----|-------|--------|----------|-----|-------|----------|--------|")
    for finding in findings:
        link = f"vulnerabilities/{finding.path.name}"
        lines.append(
            f"| {finding.id} | {finding.title} | {finding.domain} | {finding.severity} "
            f"| {finding.cwe} | {finding.owasp} | `{finding.location}` | [detail]({link}) |"
        )
    lines.append(FOOTER)
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="exit 1 if the index is stale")
    parser.add_argument("--out", type=Path, default=INDEX_PATH)
    args = parser.parse_args(argv)

    findings = collect()
    content = render(findings)

    if args.check:
        current = args.out.read_text(encoding="utf-8") if args.out.exists() else ""
        if current != content:
            print(f"{args.out} is stale — run scripts/generate_vuln_index.py", file=sys.stderr)
            return 1
        print(f"{args.out} is up to date ({len(findings)} findings)")
        return 0

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(content, encoding="utf-8")
    print(f"wrote {args.out} ({len(findings)} findings)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
