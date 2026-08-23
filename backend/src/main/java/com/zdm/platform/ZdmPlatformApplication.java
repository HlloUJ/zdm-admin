package com.zdm.platform;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

@MapperScan("com.zdm.platform")
@SpringBootApplication
@EnableAsync
@EnableScheduling
public class ZdmPlatformApplication {
  public static void main(String[] args) {
    SpringApplication.run(ZdmPlatformApplication.class, args);
  }
}
