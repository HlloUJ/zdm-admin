package com.zdm.platform;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@MapperScan("com.zdm.platform")
@SpringBootApplication
public class ZdmPlatformApplication {
  public static void main(String[] args) {
    SpringApplication.run(ZdmPlatformApplication.class, args);
  }
}
