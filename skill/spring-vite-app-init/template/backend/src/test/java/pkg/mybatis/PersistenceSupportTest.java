package __BASE_PACKAGE__.mybatis;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import __BASE_PACKAGE__.domain.entity.NoteEntity;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.fasterxml.jackson.core.type.TypeReference;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.ResultSetMetaData;
import java.util.Map;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.apache.ibatis.reflection.MetaObject;
import org.apache.ibatis.reflection.SystemMetaObject;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.postgresql.util.PGobject;

class CommonJsonTypeHandlerTest {

  @Test
  void writesJsonObject() throws Exception {
    CommonJsonTypeHandler<Map<String, Object>> handler =
        new CommonJsonTypeHandler<>(new TypeReference<>() {});
    PreparedStatement statement = mock(PreparedStatement.class);
    handler.setNonNullParameter(statement, 1, Map.of("a", 1), null);
    ArgumentCaptor<PGobject> captor = ArgumentCaptor.forClass(PGobject.class);
    verify(statement).setObject(org.mockito.ArgumentMatchers.eq(1), captor.capture());
    assertEquals("json", captor.getValue().getType());
    assertTrue(captor.getValue().getValue().contains("\"a\""));
  }

  @Test
  void readsMapUsingEntityFieldType() throws Exception {
    com.baomidou.mybatisplus.core.metadata.TableInfoHelper.initTableInfo(
        new MapperBuilderAssistant(new MybatisConfiguration(), ""), NoteEntity.class);
    ResultSet rs = mock(ResultSet.class);
    ResultSetMetaData meta = mock(ResultSetMetaData.class);
    when(rs.getMetaData()).thenReturn(meta);
    when(meta.getColumnCount()).thenReturn(1);
    when(meta.getColumnName(1)).thenReturn("j_extra");
    when(meta.getColumnLabel(1)).thenReturn("j_extra");
    when(meta.getTableName(1)).thenReturn("t_note");
    PGobject pg = new PGobject();
    pg.setType("json");
    pg.setValue("{\"k\":\"v\"}");
    when(rs.getObject("j_extra")).thenReturn(pg);

    Map<String, Object> got = new CommonJsonTypeHandler<Map<String, Object>>().getNullableResult(rs, "j_extra");
    assertEquals("v", got.get("k"));
  }
}

class AuditMetaObjectHandlerTest {

  @Test
  void fillsAuditFieldsFromProvider() {
    AuditMetaObjectHandler handler = new AuditMetaObjectHandler(() -> java.util.Optional.of("user-1"));
    NoteEntity entity = new NoteEntity();
    MetaObject metaObject = SystemMetaObject.forObject(entity);
    handler.insertFill(metaObject);
    assertEquals("user-1", entity.getCreatedUser());
    assertEquals("user-1", entity.getUpdatedUser());
    assertTrue(entity.getCreatedAt() != null && entity.getUpdatedAt() != null);
  }
}
