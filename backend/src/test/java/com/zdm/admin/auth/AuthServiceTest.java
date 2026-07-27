package com.zdm.admin.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class AuthServiceTest {
  private final AuthService authService = new AuthService();

  @Test
  void loginReturnsDevTokenForSeedVerificationCode() {
    LoginResponse response = authService.login(new LoginRequest("13800000000", "888888"));

    assertThat(response.token()).isEqualTo("dev-token");
    assertThat(response.user().roles()).contains("ADMIN");
  }

  @Test
  void loginRejectsInvalidVerificationCode() {
    assertThatThrownBy(() -> authService.login(new LoginRequest("13800000000", "123456")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("验证码错误");
  }
}
