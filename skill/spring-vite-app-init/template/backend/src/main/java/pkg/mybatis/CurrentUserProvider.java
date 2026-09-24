package __BASE_PACKAGE__.mybatis;

import java.util.Optional;

/** 当前用户。未接入登录时由 {@link EmptyCurrentUserProvider} 返回空。 */
public interface CurrentUserProvider {

  Optional<String> currentUserId();
}
