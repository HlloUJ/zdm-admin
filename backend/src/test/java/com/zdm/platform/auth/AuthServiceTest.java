package com.zdm.platform.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class AuthServiceTest {
  private AuthAccountMapper authAccountMapper;
  private AuthService authService;

  @BeforeEach
  void setUp() {
    authAccountMapper = Mockito.mock(AuthAccountMapper.class);
    authService = new AuthService(authAccountMapper);
  }

  @Test
  void loginReturnsDevTokenForSeedSuperAdmin() {
    AuthAccount account = new AuthAccount();
    account.setId(1L);
    account.setDisplayName("超级管理员");
    account.setPhone("15926626945");
    account.setStatus("enabled");
    when(authAccountMapper.findByPhone("15926626945")).thenReturn(account);
    when(authAccountMapper.findAdminRoleCodes(1L)).thenReturn(List.of("SUPER_ADMIN"));
    when(authAccountMapper.findAdminPermissionCodes(1L)).thenReturn(List.of("admin:tenant:manage"));

    LoginResponse response = authService.login(new LoginRequest("15926626945", "888888"));

    assertThat(response.token()).isEqualTo("dev-token");
    assertThat(response.user().phone()).isEqualTo("15926626945");
    assertThat(response.user().roles()).contains("SUPER_ADMIN");
  }

  @Test
  void loginRejectsInvalidVerificationCode() {
    assertThatThrownBy(() -> authService.login(new LoginRequest("15926626945", "123456")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("验证码错误");
  }

  @Test
  void loginRejectsUnknownAccount() {
    when(authAccountMapper.findByPhone("15926626945")).thenReturn(null);

    assertThatThrownBy(() -> authService.login(new LoginRequest("15926626945", "888888")))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("账号不存在或已停用");
  }
}
