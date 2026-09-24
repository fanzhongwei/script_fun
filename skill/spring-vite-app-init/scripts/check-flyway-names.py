#!/usr/bin/env python3
"""检查 Flyway 可重复脚本的目录与文件名。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from version_layout import check_migrations, migration_root


def main() -> int:
    parser = argparse.ArgumentParser(description="检查 Flyway 脚本命名")
    parser.add_argument("--project", type=Path, required=True, help="项目根目录")
    args = parser.parse_args()
    project = args.project.resolve()
    errors = check_migrations(migration_root(project))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print("Flyway 脚本命名检查通过")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
