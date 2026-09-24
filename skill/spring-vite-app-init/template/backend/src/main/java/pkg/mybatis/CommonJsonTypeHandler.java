package __BASE_PACKAGE__.mybatis;

import com.baomidou.mybatisplus.core.metadata.TableFieldInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfo;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.JavaType;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Type;
import java.nio.charset.StandardCharsets;
import java.sql.CallableStatement;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.apache.ibatis.type.BaseTypeHandler;
import org.apache.ibatis.type.JdbcType;
import org.apache.ibatis.type.MappedJdbcTypes;
import org.postgresql.util.PGobject;

/**
 * PostgreSQL JSON 类型处理器。按实体字段的泛型读写，例如 {@code List<String>}、{@code Map<String, Object>}。
 *
 * <p>用法：实体 {@code @TableName(autoResultMap = true)}，字段
 * {@code @TableField(typeHandler = CommonJsonTypeHandler.class)}。列类型使用 JSON，字段名以 {@code j_} 开头。
 */
@MappedJdbcTypes({JdbcType.OTHER, JdbcType.VARCHAR, JdbcType.LONGVARCHAR})
public class CommonJsonTypeHandler<T> extends BaseTypeHandler<T> {

  private static final ObjectMapper MAPPER = new ObjectMapper();
  private static final Map<String, TypeReference<?>> TYPE_CACHE = new ConcurrentHashMap<>();

  private TypeReference<T> typeReference;
  private Class<T> fallbackType;

  public CommonJsonTypeHandler() {}

  public CommonJsonTypeHandler(Class<T> type) {
    this.fallbackType = type;
  }

  public CommonJsonTypeHandler(TypeReference<T> typeReference) {
    this.typeReference = typeReference;
  }

  @Override
  public void setNonNullParameter(PreparedStatement ps, int index, T parameter, JdbcType jdbcType)
      throws SQLException {
    try {
      bindJson(ps, index, MAPPER.writeValueAsString(parameter));
    } catch (SQLException ex) {
      throw ex;
    } catch (Exception ex) {
      throw new SQLException("json serialize failed", ex);
    }
  }

  @Override
  public T getNullableResult(ResultSet rs, String columnName) throws SQLException {
    initTypeFromResultSet(rs, columnName);
    return parseJson(rs.getObject(columnName));
  }

  @Override
  public T getNullableResult(ResultSet rs, int columnIndex) throws SQLException {
    String columnName = null;
    try {
      columnName = rs.getMetaData().getColumnName(columnIndex);
    } catch (Exception ignored) {
      columnName = null;
    }
    if (columnName != null) {
      initTypeFromResultSet(rs, columnName);
    }
    return parseJson(rs.getObject(columnIndex));
  }

  @Override
  public T getNullableResult(CallableStatement cs, int columnIndex) throws SQLException {
    return parseJson(cs.getObject(columnIndex));
  }

  private void initTypeFromResultSet(ResultSet rs, String columnName) {
    if (typeReference != null) {
      return;
    }
    try {
      ResultSetMetaData metaData = rs.getMetaData();
      int columnCount = metaData.getColumnCount();
      for (int i = 1; i <= columnCount; i++) {
        if (columnName.equalsIgnoreCase(metaData.getColumnName(i))
            || columnName.equalsIgnoreCase(metaData.getColumnLabel(i))) {
          String tableName = safeTableName(metaData, i);
          if (tableName != null) {
            initTypeByTableAndColumn(tableName, columnName);
            return;
          }
        }
      }
    } catch (Exception ignored) {
      // 元数据不可用时退回按列名扫描
    }
    initTypeByColumnNameOnly(columnName);
  }

  @SuppressWarnings("unchecked")
  private void initTypeByTableAndColumn(String tableName, String columnName) {
    if (typeReference != null) {
      return;
    }
    String normalizedTableName = normalizeTableName(tableName);
    String cacheKey = normalizedTableName + "#" + columnName.toLowerCase();
    TypeReference<?> cached = TYPE_CACHE.get(cacheKey);
    if (cached != null) {
      this.typeReference = (TypeReference<T>) cached;
      return;
    }
    TableInfo tableInfo = findTable(normalizedTableName);
    if (tableInfo == null) {
      return;
    }
    TableFieldInfo fieldInfo = findField(tableInfo, columnName);
    if (fieldInfo == null) {
      return;
    }
    TypeReference<?> typeRef = createTypeReference(fieldInfo.getField());
    if (typeRef != null) {
      TYPE_CACHE.put(cacheKey, typeRef);
      this.typeReference = (TypeReference<T>) typeRef;
    }
  }

  @SuppressWarnings("unchecked")
  private void initTypeByColumnNameOnly(String columnName) {
    if (typeReference != null) {
      return;
    }
    for (TableInfo tableInfo : TableInfoHelper.getTableInfos()) {
      TableFieldInfo fieldInfo = findField(tableInfo, columnName);
      if (fieldInfo == null) {
        continue;
      }
      TypeReference<?> typeRef = createTypeReference(fieldInfo.getField());
      if (typeRef == null) {
        continue;
      }
      String cacheKey = normalizeTableName(tableInfo.getTableName()) + "#" + columnName.toLowerCase();
      TYPE_CACHE.put(cacheKey, typeRef);
      this.typeReference = (TypeReference<T>) typeRef;
      return;
    }
  }

  private static TableInfo findTable(String normalizedTableName) {
    TableInfo tableInfo = TableInfoHelper.getTableInfo(normalizedTableName);
    if (tableInfo != null) {
      return tableInfo;
    }
    for (TableInfo info : TableInfoHelper.getTableInfos()) {
      if (normalizedTableName.equalsIgnoreCase(normalizeTableName(info.getTableName()))) {
        return info;
      }
    }
    return null;
  }

  private static TableFieldInfo findField(TableInfo tableInfo, String columnName) {
    return tableInfo.getFieldList().stream()
        .filter(field -> columnName.equalsIgnoreCase(field.getColumn()))
        .findFirst()
        .orElse(null);
  }

  private static String safeTableName(ResultSetMetaData metaData, int columnIndex) {
    try {
      String tableName = metaData.getTableName(columnIndex);
      if (tableName == null || tableName.isBlank()) {
        return null;
      }
      return normalizeTableName(tableName);
    } catch (Exception ex) {
      return null;
    }
  }

  private static String normalizeTableName(String tableName) {
    if (tableName == null || tableName.isBlank()) {
      return tableName;
    }
    int dot = tableName.lastIndexOf('.');
    return dot >= 0 ? tableName.substring(dot + 1) : tableName;
  }

  private static TypeReference<?> createTypeReference(Field field) {
    Type type = field.getGenericType();
    if (type == null) {
      return null;
    }
    JavaType javaType = MAPPER.getTypeFactory().constructType(type);
    return new TypeReference<Object>() {
      @Override
      public JavaType getType() {
        return javaType;
      }
    };
  }

  private static void bindJson(PreparedStatement ps, int index, String json) throws SQLException {
    PGobject value = new PGobject();
    value.setType("json");
    value.setValue(json);
    ps.setObject(index, value);
  }

  @SuppressWarnings("unchecked")
  private T parseJson(Object value) throws SQLException {
    if (value == null) {
      return null;
    }
    String raw;
    if (value instanceof PGobject pgObject) {
      raw = pgObject.getValue();
    } else if (value instanceof byte[] bytes) {
      raw = new String(bytes, StandardCharsets.UTF_8);
    } else {
      raw = value.toString();
    }
    if (raw == null || raw.isBlank()) {
      return null;
    }
    try {
      String normalized = raw;
      if (normalized.startsWith("\"") && normalized.endsWith("\"")) {
        normalized = MAPPER.readValue(normalized, String.class);
      }
      if (typeReference != null) {
        return MAPPER.readValue(normalized, typeReference);
      }
      if (fallbackType != null) {
        return MAPPER.readValue(normalized, fallbackType);
      }
      return (T) normalized;
    } catch (Exception ex) {
      throw new SQLException("json parse failed", ex);
    }
  }
}
