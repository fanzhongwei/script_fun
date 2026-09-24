#!/usr/bin/env python3
"""以 backend/pom.xml 为唯一版本源，同步前端版本并给出下一份迁移文件路径。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from version_layout import (
    format_version,
    next_migration_path,
    parse_version,
    read_pom_version,
    release_version,
    write_package_version,
    write_pom_version,
)


def next_version(current: str, bump: str, release: bool) -> str:
    major, minor, patch, snapshot = parse_version(current)
    if bump == "major":
        major, minor, patch = major + 1, 0, 0
    elif bump == "minor":
        minor, patch = minor + 1, 0
    elif bump == "patch":
        patch += 1
    keep_snapshot = snapshot and not release
    return format_version(major, minor, patch, keep_snapshot)


def main() -> int:
    parser = argparse.ArgumentParser(description="升版本并打印下一份 Flyway 脚本路径")
    parser.add_argument("--project", type=Path, required=True)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--bump", choices=["patch", "minor", "major"])
    group.add_argument("--set", help="直接设为 MAJOR.MINOR.PATCH 或带 -SNAPSHOT")
    group.add_argument("--release", action="store_true", help="去掉 -SNAPSHOT，数字不变")
    parser.add_argument(
        "--as-release",
        action="store_true",
        help="与 --bump 或 --set 合用，结果不带 -SNAPSHOT",
    )
    parser.add_argument("--name", default="change", help="下一份脚本的英文名")
    args = parser.parse_args()

    project = args.project.resolve()
    pom = project / "backend" / "pom.xml"
    package_json = project / "frontend" / "package.json"
    current = read_pom_version(pom)
    if args.set:
        parse_version(args.set)
        version = args.set
        if args.as_release:
            version = release_version(version)
    elif args.release:
        version = release_version(current)
    else:
        version = next_version(current, args.bump, args.as_release)

    write_pom_version(pom, version)
    write_package_version(package_json, release_version(version))
    path = next_migration_path(project, version, args.name)
    print(f"version={version}")
    print(f"frontend={release_version(version)}")
    print(f"next_migration={path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
