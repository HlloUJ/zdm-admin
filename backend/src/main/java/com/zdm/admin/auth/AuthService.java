package com.zdm.admin.auth;

import com.zdm.admin.security.TokenAuthenticationFilter;
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
        List.of("tenant:manage", "store:manage", "role:manage", "employee:manage"));
    return new LoginResponse(TokenAuthenticationFilter.DEV_TOKEN, user);
  }
}
