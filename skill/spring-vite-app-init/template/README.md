# __SLUG__

JDK 21 + Spring Boot 与 Vite + React 的单体。开发时前后端分开，`mvn package` 把前端打进同一个 JAR。

## 本地运行

数据库只需先建库，schema 由 Flyway 创建：

```sql
CREATE DATABASE __DB_NAME__;
```

环境变量：`DB_HOST`（默认 127.0.0.1）、`DB_PORT`（默认 5432）、`DB_USERNAME`、`DB_PASSWORD`。

```bash
cd backend && mvn spring-boot:run
cd frontend && npm install && npm run dev
```

前端开发地址 `http://127.0.0.1:3000`，接口代理到 `http://127.0.0.1:__PORT__`。

## 发布

在 `backend/` 执行 `mvn package`。JAR 内含 `classpath:/static` 下的前端构建结果。

版本以 `backend/pom.xml` 里 `<!-- app-version -->` 为准。`frontend/package.json` 使用去掉 `-SNAPSHOT` 的同一数字。新增数据库脚本的文件名由该版本推导，规则见 `.cursor/rules/app-conventions.mdc`。
