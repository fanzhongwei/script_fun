package __BASE_PACKAGE__.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

  @Bean
  OpenAPI appOpenApi(@Value("${app.version:unknown}") String version) {
    String shown = version.endsWith("-SNAPSHOT") ? version.substring(0, version.length() - "-SNAPSHOT".length()) : version;
    return new OpenAPI()
        .info(
            new Info()
                .title("__SLUG__ API")
                .description("REST 前缀 /api/v1。文档由 springdoc 根据注解生成，不维护静态 openapi 文件。")
                .version(shown));
  }
}
