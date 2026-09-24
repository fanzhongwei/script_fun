package __BASE_PACKAGE__.config;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.context.annotation.Configuration;

/** 与启动类分开，避免 Web 切片测试装配 Mapper。 */
@Configuration
@MapperScan("__BASE_PACKAGE__.mapper")
public class MapperScanConfig {}
