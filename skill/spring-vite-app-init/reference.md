# 版本与 Flyway

`backend/pom.xml` 里 `<!-- app-version -->` 下的 `<version>` 是唯一版本源。格式 `MAJOR.MINOR.PATCH` 或 `MAJOR.MINOR.PATCH-SNAPSHOT`。

| 产物 | 规则 |
| --- | --- |
| `frontend/package.json` | 同一数字，去掉 `-SNAPSHOT` |
| OpenAPI `info.version` | Maven 把 `@project.version@` 滤进 `app.version`，展示时去掉 `-SNAPSHOT` |
| Docker | `COPY target/<artifactId>-*.jar`，升版本不改 Dockerfile |
| Flyway 目录 | `v{主版本两位}_{次版本两位}`，例如 `0.1.x` → `v00_01`，`10.0.x` → `v10_00` |
| Flyway 文件 | `R__v{主版本两位}_{次版本两位}_{补丁三位}__{序号三位}__{英文名}.sql` |

补丁 +1：目录不变，补丁段 +1，序号从 `001` 重计。次版本 +1：新目录，补丁段 `000`，序号从 `001`。主版本 +1：次版本与补丁归零。同一补丁内只加序号。已在共享环境跑过的排序键不改名。

脚本必须幂等。不为 Flyway 写单元测试。

## 升版本

```bash
python3-dev ~/.cursor/skills/spring-vite-app-init/scripts/bump-version.py \
  --project <项目根> \
  --bump patch
```

`--bump` 取 `patch`、`minor`、`major`。开发期默认保留 `-SNAPSHOT`。发版数字不变、去掉 SNAPSHOT：`--release`。指定版本：`--set 1.2.0-SNAPSHOT`。结果不要 SNAPSHOT 时加 `--as-release`。

脚本打印 `next_migration=`。在该路径新建 SQL（把 `change` 换成英文名），写完执行：

```bash
python3-dev ~/.cursor/skills/spring-vite-app-init/scripts/check-flyway-names.py --project <项目根>
```

## JSON 列

```java
@TableName(value = "t_example", schema = "db_demo", autoResultMap = true)
public class ExampleEntity extends BaseEntity {
  @TableField(value = "j_extra", typeHandler = CommonJsonTypeHandler.class)
  private Map<String, Object> extra;
}
```

列类型用 `JSON`。处理器按实体字段泛型反序列化，并把值写成 PostgreSQL `json`。

## 字段前缀

| 类型 | 前缀 | 示例 |
| --- | --- | --- |
| VARCHAR / CHAR / TEXT | `c_` | `c_title VARCHAR(100)` |
| INT / NUMERIC | `n_` | `n_seq INT` |
| DATE | `d_` | `d_biz DATE` |
| TIMESTAMP | `dt_` | `dt_created_at TIMESTAMP` |
| JSON | `j_` | `j_extra JSON` |
| 字符串数组 | `arr_c` | `arr_c_tags VARCHAR(100)[]` |
| 整数数组 | `arr_n` | `arr_n_ids INT[]` |

主键 `c_id VARCHAR(32)`。除主键外，字符串长度是 100 的整数倍。每张表带四个审计字段。不建外键。中文注释。
