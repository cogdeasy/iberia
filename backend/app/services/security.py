"""Findings register.

The security console does not keep its own copy of the planted-vulnerability inventory:
it parses ``docs/vulnerabilities/VULN-*.md`` at startup so the register stays in sync with
whatever the other workstreams plant. Missing directory or malformed file => skipped.
"""

import logging
import os
import re
from pathlib import Path

from app.core.observability import log_event
from app.schemas.security import CategoryCount, Finding, Posture, SeverityCounts

logger = logging.getLogger("iberia.security")

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_VULN_DIR = REPO_ROOT / "docs" / "vulnerabilities"

SEVERITY_WEIGHTS = {"critical": 15, "high": 8, "medium": 3, "low": 1}
SEVERITY_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "unknown": 4}

_TITLE_RE = re.compile(r"^#\s*(?P<id>VULN-\d+)\s*[—\-–:]\s*(?P<title>.+?)\s*$")
_ROW_RE = re.compile(r"^\|\s*(?P<key>[^|]+?)\s*\|\s*(?P<value>.*?)\s*\|\s*$")
_HEADING_RE = re.compile(r"^##\s+(?P<heading>.+?)\s*$")

_FIELD_ALIASES = {
    "id": "id",
    "domain": "domain",
    "cwe": "cwe",
    "severity": "severity",
    "location": "location",
    "status": "status",
    "title": "title",
}


def vuln_dir() -> Path:
    override = os.getenv("IBERIA_VULN_DIR")
    return Path(override) if override else DEFAULT_VULN_DIR


def _clean(value: str) -> str:
    return value.replace("`", "").replace("**", "").strip()


def _section_text(lines: list[str], wanted: tuple[str, ...]) -> str:
    collected: list[str] = []
    capturing = False
    for line in lines:
        heading = _HEADING_RE.match(line)
        if heading:
            name = heading.group("heading").strip().lower()
            capturing = any(word in name for word in wanted)
            continue
        if capturing:
            collected.append(line.rstrip())
    return "\n".join(collected).strip()


def parse_finding_file(path: Path) -> Finding | None:
    """Parse one ``VULN-*.md`` file into a :class:`Finding` (``None`` if unparseable)."""
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return None

    lines = raw.splitlines()
    fields: dict[str, str] = {}
    title = ""

    for line in lines:
        title_match = _TITLE_RE.match(line)
        if title_match and not title:
            fields.setdefault("id", title_match.group("id"))
            title = title_match.group("title").strip()
            continue
        row = _ROW_RE.match(line)
        if row:
            key = _clean(row.group("key")).lower()
            value = _clean(row.group("value"))
            if not value or value.startswith("---") or key in {"field", "value"}:
                continue
            if key.startswith("owasp"):
                fields["owasp"] = value
            elif key in _FIELD_ALIASES:
                fields[_FIELD_ALIASES[key]] = value

    finding_id = fields.get("id", "")
    if not re.fullmatch(r"VULN-\d+", finding_id):
        # Fall back to the filename (VULN-140-slug.md) so a missing table row is tolerated.
        name_match = re.match(r"(VULN-\d+)", path.stem)
        if not name_match:
            return None
        finding_id = name_match.group(1)

    return Finding(
        id=finding_id,
        title=fields.get("title") or title or finding_id,
        severity=(fields.get("severity") or "unknown").lower(),
        cwe=fields.get("cwe", ""),
        owasp=fields.get("owasp", ""),
        location=fields.get("location", ""),
        status=(fields.get("status") or "open").lower(),
        description=_section_text(lines, ("description",)),
        remediation=_section_text(lines, ("remediation",)),
        domain=fields.get("domain", ""),
    )


def load_findings(directory: Path | None = None) -> list[Finding]:
    """Parse every ``VULN-*.md`` in ``directory`` (defaults to docs/vulnerabilities)."""
    target = directory or vuln_dir()
    findings: list[Finding] = []
    if not target.is_dir():
        log_event(logger, logging.WARNING, "findings directory missing", directory=str(target))
        return findings
    for path in sorted(target.glob("VULN-*.md")):
        finding = parse_finding_file(path)
        if finding is None:
            log_event(logger, logging.WARNING, "finding unparseable", file=path.name)
            continue
        findings.append(finding)
    return sorted(
        findings,
        key=lambda f: (SEVERITY_ORDER.get(f.severity, 4), f.id),
    )


_CACHE: list[Finding] | None = None


def findings(refresh: bool = False) -> list[Finding]:
    """Cached register; reparsed on demand (``refresh=True``) after new files land."""
    global _CACHE
    if _CACHE is None or refresh:
        _CACHE = load_findings()
        log_event(logger, logging.INFO, "findings register loaded", count=len(_CACHE))
    return _CACHE


def owasp_category(finding: Finding) -> str:
    if not finding.owasp:
        return "Unmapped"
    return finding.owasp.strip()


def posture(items: list[Finding]) -> Posture:
    counts = SeverityCounts()
    penalty = 0
    for finding in items:
        penalty += SEVERITY_WEIGHTS.get(finding.severity, 0)
        if hasattr(counts, finding.severity):
            setattr(counts, finding.severity, getattr(counts, finding.severity) + 1)
    categories: dict[str, int] = {}
    for finding in items:
        category = owasp_category(finding)
        categories[category] = categories.get(category, 0) + 1
    return Posture(
        score=max(0, 100 - penalty),
        total=len(items),
        counts=counts,
        categories=[
            CategoryCount(category=name, count=count)
            for name, count in sorted(categories.items(), key=lambda kv: (-kv[1], kv[0]))
        ],
    )
