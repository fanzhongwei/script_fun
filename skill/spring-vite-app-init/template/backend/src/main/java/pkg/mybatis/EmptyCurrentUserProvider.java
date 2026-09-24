package __BASE_PACKAGE__.mybatis;

import java.util.Optional;
import org.springframework.stereotype.Component;

@Component
public class EmptyCurrentUserProvider implements CurrentUserProvider {

  @Override
  public Optional<String> currentUserId() {
    return Optional.empty();
  }
}
