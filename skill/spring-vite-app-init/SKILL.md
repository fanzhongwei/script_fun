---
name: spring-vite-app-init
description: >-
  Scaffolds a JDK 21 Spring Boot and Vite React monolith that ships as one JAR,
  with PostgreSQL, idempotent Flyway scripts, versioned migration names, and a
  reusable JSON type handler. Use when the user asks to initialize a project,
  scaffold a Spring and Vite app, create a fullstack JAR, or says 初始化项目、
  新建单体、前后端打成一个 JAR.
---

# 初始化 Spring + Vite 单体

只运行本技能的脚本生成项目。不要从现有业务仓库复制代码。

持久化默认开启。数据库只用 PostgreSQL。技能目录：`~/.cursor/skills/spring-vite-app-init/`。

## 先收集参数

缺任一项就询问，不要猜业务名：

| 参数 | 默认 |
| --- | --- |
| 目标空目录 | 无，必填 |
| slug | 无，必填。`^[a-z][a-z0-9-]{0,39}$` |
| groupId | 无，必填 |
| Java 包名 | 无，必填。至少两段小写包名 |
| 端口 | `8080` |
| 版本 | `0.1.0-SNAPSHOT` |
| 库名 / schema | `db_{slug}`，连字符改为下划线 |
| 前端 base | `/` |
| npm 仓库 | 空，使用 npm 默认源 |

## 生成

用 `python3-dev` 执行（不要用未限定的 `python3`）：

```bash
python3-dev ~/.cursor/skills/spring-vite-app-init/scripts/init.py \
  --dest <空目录> \
  --slug <slug> \
  --group-id <groupId> \
  --package <包名>
```

可选：`--port` `--version` `--db-name` `--base-path` `--npm-registry`。

脚本会：渲染模板、检查 Flyway 文件名、若 PATH 中没有 `openspec` 则 `npm install -g @fission-ai/openspec@1.13.0`，再执行 `openspec init --tools cursor --language zh --no-animation`，并写入 `openspec/config.yaml`。

目标目录只能是空目录或仅含 `.git`。不要初始化到技能目录里面。

## 生成后验证

在新项目中，JDK 21：

```bash
python3-dev ~/.cursor/skills/spring-vite-app-init/scripts/check-flyway-names.py --project <项目根>
cd backend && mvn test
```

用户需要可运行的 JAR 时再执行 `mvn package`（会安装前端依赖并构建静态资源）。数据库要事先 `CREATE DATABASE`，schema 由 Flyway 创建。

## 之后升版本

读 [reference.md](reference.md)。用 `scripts/bump-version.py` 改 pom 与 `package.json`，按它打印的路径新增幂等 SQL，再跑命名检查。不要改已发布脚本的排序键。

## 模板里已可直接用

- `CommonJsonTypeHandler`：JSON 列，配合 `autoResultMap = true`
- `BaseEntity` 与 `AuditMetaObjectHandler`
- `t_note` / `j_extra` 示例
- `.cursor/rules/app-conventions.mdc`
