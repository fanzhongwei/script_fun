"""Maven 版本与 Flyway 可重复脚本路径的对应关系。"""

from __future__ import annotations

import re
from pathlib import Path

VERSION_RE = re.compile(r"^(\d+)\.(\d+)\.(\d+)(-SNAPSHOT)?$")
FILE_RE = re.compile(r"^R__(v\d{2}_\d{2}_\d{3})__(\d{3})__([a-z0-9_]+)\.sql$")
POM_VERSION_RE = re.compile(
    r"(<!-- app-version -->\s*<version>)([^<]+)(</version>)",
    re.MULTILINE,
)


def parse_version(text: str) -> tuple[int, int, int, bool]:
    match = VERSION_RE.match(text.strip())
    if not match:
        raise ValueError(f"版本号须为 MAJOR.MINOR.PATCH 或带 -SNAPSHOT：{text}")
    return int(match.group(1)), int(match.group(2)), int(match.group(3)), bool(match.group(4))


def format_version(major: int, minor: int, patch: int, snapshot: bool) -> str:
    base = f"{major}.{minor}.{patch}"
    return f"{base}-SNAPSHOT" if snapshot else base


def release_version(version: str) -> str:
    major, minor, patch, _snapshot = parse_version(version)
    return format_version(major, minor, patch, False)


def flyway_dir(major: int, minor: int) -> str:
    return f"v{major:02d}_{minor:02d}"


def flyway_key(major: int, minor: int, patch: int) -> str:
    return f"v{major:02d}_{minor:02d}_{patch:03d}"


def dir_for_key(key: str) -> str:
    return key.rsplit("_", 1)[0]


def migration_root(project: Path) -> Path:
    return project / "backend" / "src" / "main" / "resources" / "db" / "migration"


def read_pom_version(pom: Path) -> str:
    text = pom.read_text(encoding="utf-8")
    match = POM_VERSION_RE.search(text)
    if not match:
        raise ValueError(f"未找到 <!-- app-version --> 标记：{pom}")
    return match.group(2).strip()


def write_pom_version(pom: Path, version: str) -> None:
    text = pom.read_text(encoding="utf-8")
    updated, count = POM_VERSION_RE.subn(rf"\g<1>{version}\g<3>", text, count=1)
    if count != 1:
        raise ValueError(f"未能写回 pom 版本：{pom}")
    pom.write_text(updated, encoding="utf-8")


def write_package_version(package_json: Path, release: str) -> None:
    text = package_json.read_text(encoding="utf-8")
    updated, count = re.subn(
        r'("version"\s*:\s*")[^"]+"',
        rf'\g<1>{release}"',
        text,
        count=1,
    )
    if count != 1:
        raise ValueError(f"未能写回 package.json 版本：{package_json}")
    package_json.write_text(updated, encoding="utf-8")


def check_migrations(root: Path) -> list[str]:
    errors: list[str] = []
    if not root.is_dir():
        return [f"迁移目录不存在：{root}"]
    seen: dict[str, str] = {}
    files = sorted(path for path in root.rglob("*.sql") if path.is_file())
    if not files:
        errors.append(f"{root} 下没有 SQL 脚本")
    for path in files:
        relative = path.relative_to(root)
        if len(relative.parts) != 2:
            errors.append(f"{relative} 必须放在 vXX_YY/ 目录下")
            continue
        directory, name = relative.parts
        match = FILE_RE.match(name)
        if not match:
            errors.append(
                f"{relative} 不符合 R__vMM_mm_ppp__sss__name.sql"
                "（主版本、次版本各两位，补丁与序号各三位，名称为小写英文与下划线）"
            )
            continue
        key, seq = match.group(1), match.group(2)
        expected_dir = dir_for_key(key)
        if directory != expected_dir:
            errors.append(f"{relative} 所在目录应为 {expected_dir}/")
        sort_key = f"{key}__{seq}"
        if sort_key in seen:
            errors.append(f"排序键重复 {sort_key}：{seen[sort_key]} 与 {relative}")
        else:
            seen[sort_key] = str(relative)
    return errors


def next_seq(root: Path, key: str) -> int:
    seqs: list[int] = []
    if not root.is_dir():
        return 1
    for path in root.rglob("*.sql"):
        match = FILE_RE.match(path.name)
        if match and match.group(1) == key:
            seqs.append(int(match.group(2)))
    return max(seqs) + 1 if seqs else 1


def next_migration_path(project: Path, version: str, name: str = "change") -> Path:
    major, minor, patch, _snapshot = parse_version(version)
    key = flyway_key(major, minor, patch)
    directory = flyway_dir(major, minor)
    seq = next_seq(migration_root(project), key)
    filename = f"R__{key}__{seq:03d}__{name}.sql"
    return migration_root(project) / directory / filename
