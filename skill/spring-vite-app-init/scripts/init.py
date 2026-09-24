#!/usr/bin/env python3
"""把 Spring Boot + Vite 单体模板渲染到空目录，并初始化 OpenSpec。"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from version_layout import check_migrations, flyway_dir, flyway_key, migration_root, parse_version, release_version

SKILL_ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL_ROOT / "template"
OPENSPEC_PACKAGE = "@fission-ai/openspec@1.13.0"
SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
PACKAGE_RE = re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$")

TOKEN_ORDER = (
    "__VERSION_RELEASE__",
    "__VERSION__",
    "__BASE_PACKAGE__",
    "__BASE_PATH__",
    "__GROUP_ID__",
    "__DB_NAME__",
    "__FLYWAY_DIR__",
    "__FLYWAY_KEY__",
    "__SLUG__",
    "__PORT__",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="初始化 Spring + Vite 单体项目")
    parser.add_argument("--dest", type=Path, required=True)
    parser.add_argument("--slug", required=True, help="项目短名，小写字母、数字、连字符")
    parser.add_argument("--group-id", required=True)
    parser.add_argument("--package", dest="base_package", required=True, help="Java 根包名")
    parser.add_argument("--port", type=int, default=8080)
    parser.add_argument("--version", default="0.1.0-SNAPSHOT")
    parser.add_argument("--db-name", default="")
    parser.add_argument("--base-path", default="/")
    parser.add_argument("--npm-registry", default="", help="留空则使用 npm 默认仓库")
    return parser.parse_args()


def validate(args: argparse.Namespace) -> str:
    if not SLUG_RE.match(args.slug):
        raise SystemExit("slug 须匹配 ^[a-z][a-z0-9-]{0,39}$")
    if not PACKAGE_RE.match(args.base_package):
        raise SystemExit("package 须为小写 Java 包名，至少两段")
    if not (1 <= args.port <= 65535):
        raise SystemExit("port 超出范围")
    parse_version(args.version)
    base_path = args.base_path.strip() or "/"
    if not base_path.startswith("/"):
        raise SystemExit("base-path 须以 / 开头")
    if not base_path.endswith("/"):
        base_path += "/"
    db_name = args.db_name.strip() or "db_" + args.slug.replace("-", "_")
    if not re.match(r"^[a-z][a-z0-9_]{0,62}$", db_name):
        raise SystemExit("db-name 须为小写字母、数字、下划线")
    args.db_name = db_name
    return base_path


def dest_is_usable(dest: Path) -> bool:
    if not dest.exists():
        return True
    names = {child.name for child in dest.iterdir()}
    return names <= {".git"}


def tokens(args: argparse.Namespace, base_path: str) -> dict[str, str]:
    major, minor, patch, _snapshot = parse_version(args.version)
    return {
        "__VERSION_RELEASE__": release_version(args.version),
        "__VERSION__": args.version,
        "__BASE_PACKAGE__": args.base_package,
        "__BASE_PATH__": base_path,
        "__GROUP_ID__": args.group_id,
        "__DB_NAME__": args.db_name,
        "__FLYWAY_DIR__": flyway_dir(major, minor),
        "__FLYWAY_KEY__": flyway_key(major, minor, patch),
        "__SLUG__": args.slug,
        "__PORT__": str(args.port),
    }


def apply_tokens(dest: Path, mapping: dict[str, str]) -> None:
    for path in sorted((p for p in dest.rglob("*") if p.is_file()), key=lambda item: len(item.parts), reverse=True):
        text = path.read_text(encoding="utf-8")
        for key in TOKEN_ORDER:
            text = text.replace(key, mapping[key])
        path.write_text(text, encoding="utf-8")
    for path in sorted((p for p in dest.rglob("*") if p.exists()), key=lambda item: len(item.parts), reverse=True):
        name = path.name
        renamed = name
        for key in TOKEN_ORDER:
            renamed = renamed.replace(key, mapping[key])
        if renamed != name:
            path.rename(path.with_name(renamed))


def move_package(dest: Path, base_package: str) -> None:
    package_path = Path(*base_package.split("."))
    for root in (
        dest / "backend" / "src" / "main" / "java" / "pkg",
        dest / "backend" / "src" / "test" / "java" / "pkg",
    ):
        if not root.is_dir():
            continue
        target = root.parent / package_path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.move(str(root), str(target))


def inject_npm_registry(pom: Path, registry: str) -> None:
    text = pom.read_text(encoding="utf-8")
    extra = ""
    if registry:
        extra = f"                <argument>--registry={registry}</argument>\n"
    if "__NPM_INSTALL_EXTRA__\n" not in text and "__NPM_INSTALL_EXTRA__" not in text:
        raise SystemExit("模板 pom 缺少 __NPM_INSTALL_EXTRA__")
    pom.write_text(text.replace("__NPM_INSTALL_EXTRA__\n", extra).replace("__NPM_INSTALL_EXTRA__", extra), encoding="utf-8")


def ensure_openspec() -> None:
    if shutil.which("openspec"):
        return
    npm = shutil.which("npm")
    if not npm:
        raise SystemExit("未找到 openspec，且 PATH 中没有 npm，无法自动安装")
    print(f"未找到 openspec，正在安装 {OPENSPEC_PACKAGE}")
    subprocess.check_call([npm, "install", "-g", OPENSPEC_PACKAGE])
    if not shutil.which("openspec"):
        raise SystemExit("openspec 安装后仍不在 PATH 中")


def write_openspec_config(dest: Path, args: argparse.Namespace) -> None:
    config = dest / "openspec" / "config.yaml"
    major, minor, patch, _snapshot = parse_version(args.version)
    body = f"""schema: spec-driven

context: |
  Language: zh
  All artifacts must be written in zh.
  Keep OpenSpec structural headings and SHALL/MUST keywords in English.
  归档前必须先把 delta spec 同步到主 specs，再归档。
  Tech: JDK 21, Spring Boot 3, MyBatis-Plus, Druid, Flyway, PostgreSQL, Vite, React, TypeScript, Tailwind.
  Layout: frontend/ 与 backend/。发布时 Maven prepare-package 构建前端并拷入 classpath:/static，只产出一个 JAR。
  API 前缀 /api/v1，路径从 ApiV1Paths.BASE 拼接。接口文档只使用 springdoc 注解，不提交静态 openapi 文件。
  Database: PostgreSQL。库名与 schema 均为 {args.db_name}。表名 t_ 开头。字段前缀 c_/n_/d_/dt_/j_/arr_c/arr_n。主键 c_id。字符串长度为 100 的整数倍，主键除外。每张表含 c_created_user、dt_created_at、dt_updated_at、c_updated_user。不建外键。JSON 列使用 CommonJsonTypeHandler，实体 autoResultMap = true。
  Flyway: 可重复脚本 R__，SQL 必须幂等。目录 v{{主版本两位}}_{{次版本两位}}，文件名 R__v{{主版本两位}}_{{次版本两位}}_{{补丁三位}}__{{序号三位}}__{{英文名}}.sql。当前版本 {args.version} 对应目录 v{major:02d}_{minor:02d}、补丁段 {patch:03d}。版本以 backend/pom.xml 的 app-version 为准。已发布排序键不改名。
  单元测试不启动 DataSource、Flyway、MyBatis，也不使用 H2。@MapperScan 放在独立配置类，不要写在启动类上。
"""
    config.write_text(body, encoding="utf-8")


def init_openspec(dest: Path, args: argparse.Namespace) -> None:
    ensure_openspec()
    if (dest / "openspec" / "config.yaml").is_file():
        write_openspec_config(dest, args)
        return
    subprocess.check_call(
        [
            "openspec",
            "init",
            "--tools",
            "cursor",
            "--language",
            "zh",
            "--no-animation",
            str(dest),
        ]
    )
    write_openspec_config(dest, args)


def main() -> int:
    args = parse_args()
    base_path = validate(args)
    dest = args.dest.expanduser().resolve()
    if dest == SKILL_ROOT or SKILL_ROOT in dest.parents:
        raise SystemExit("不能把项目初始化到技能目录内")
    if not dest_is_usable(dest):
        raise SystemExit(f"目标目录非空：{dest}")
    dest.mkdir(parents=True, exist_ok=True)
    shutil.copytree(TEMPLATE, dest, dirs_exist_ok=True)
    inject_npm_registry(dest / "backend" / "pom.xml", args.npm_registry.strip())
    apply_tokens(dest, tokens(args, base_path))
    move_package(dest, args.base_package)
    errors = check_migrations(migration_root(dest))
    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        raise SystemExit("生成的 Flyway 脚本未通过命名检查")
    init_openspec(dest, args)
    print(f"project={dest}")
    print(f"db={args.db_name}")
    print(f"port={args.port}")
    print("下一步：创建 PostgreSQL 数据库后，在 backend/ 执行 mvn test，再按需 mvn package")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
