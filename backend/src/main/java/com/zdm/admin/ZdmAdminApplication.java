package com.zdm.admin;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@MapperScan("com.zdm.admin")
@SpringBootApplication
public class ZdmAdminApplication {
  public static void main(String[] args) {
    SpringApplication.run(ZdmAdminApplication.class, args);
  }
}
