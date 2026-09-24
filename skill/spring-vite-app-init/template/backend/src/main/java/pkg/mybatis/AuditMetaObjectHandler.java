package __BASE_PACKAGE__.mybatis;

import com.baomidou.mybatisplus.core.handlers.MetaObjectHandler;
import java.time.LocalDateTime;
import org.apache.ibatis.reflection.MetaObject;
import org.springframework.stereotype.Component;

@Component
public class AuditMetaObjectHandler implements MetaObjectHandler {

  private final CurrentUserProvider currentUserProvider;

  public AuditMetaObjectHandler(CurrentUserProvider currentUserProvider) {
    this.currentUserProvider = currentUserProvider;
  }

  @Override
  public void insertFill(MetaObject metaObject) {
    LocalDateTime now = LocalDateTime.now();
    setFieldValByName("createdAt", now, metaObject);
    setFieldValByName("updatedAt", now, metaObject);
    currentUserProvider
        .currentUserId()
        .ifPresent(
            userId -> {
              setFieldValByName("createdUser", userId, metaObject);
              setFieldValByName("updatedUser", userId, metaObject);
            });
  }

  @Override
  public void updateFill(MetaObject metaObject) {
    setFieldValByName("updatedAt", LocalDateTime.now(), metaObject);
    currentUserProvider
        .currentUserId()
        .ifPresent(userId -> setFieldValByName("updatedUser", userId, metaObject));
  }
}
