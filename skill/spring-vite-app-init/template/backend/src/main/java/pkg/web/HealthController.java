package __BASE_PACKAGE__.web;

import __BASE_PACKAGE__.web.dto.HealthResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@Tag(name = "健康检查")
@RestController
@RequestMapping(ApiV1Paths.BASE)
public class HealthController {

  private final String version;

  public HealthController(@Value("${app.version:unknown}") String version) {
    this.version = version;
  }

  @Operation(summary = "健康检查", description = "返回进程状态与版本")
  @ApiResponses({@ApiResponse(responseCode = "200", description = "进程可响应")})
  @GetMapping("/health")
  public HealthResponse health() {
    return new HealthResponse("UP", version);
  }
}
