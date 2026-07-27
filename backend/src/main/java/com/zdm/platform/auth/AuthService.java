package com.zdm.platform.auth;

import com.zdm.platform.security.TokenAuthenticationFilter;
import java.util.List;
import org.springframework.stereotype.Service;

@Service
public class AuthService {
  public LoginResponse login(LoginRequest request) {
    if (!"888888".equals(request.verifyCode())) {
      throw new IllegalArgumentException("验证码错误");
    }
    var user = new LoginResponse.LoginUser(
        1L,
        "系统管理员",
        request.phone(),
        List.of("ADMIN"),
        List.of(
            "admin:tenant:manage",
            "admin:store:manage",
            "admin:role:manage",
            "admin:employee:manage",
            "admin:catalog:manage",
            "admin:inventory:manage",
            "admin:supplier:manage",
            "admin:craft:manage",
            "admin:order:manage"));
    return new LoginResponse(TokenAuthenticationFilter.DEV_TOKEN, user);
  }
}
