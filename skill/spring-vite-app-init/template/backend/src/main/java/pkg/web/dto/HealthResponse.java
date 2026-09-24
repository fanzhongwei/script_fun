package __BASE_PACKAGE__.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "健康检查")
public record HealthResponse(
    @Schema(description = "状态", example = "UP") String status,
    @Schema(description = "应用版本", example = "0.1.0") String version) {}
