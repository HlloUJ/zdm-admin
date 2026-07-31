package com.zdm.platform.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.zdm.platform.config.SecurityProperties;
import com.zdm.platform.security.SessionTokenService;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class AuthServiceTest {
  private AuthAccountMapper authAccountMapper;
  private SessionTokenService sessionTokenService;
  private SecurityProperties securityProperties;
  private AuthService authService;

  @BeforeEach
  void setUp() {
    authAccountMapper = Mockito.mock(AuthAccountMapper.class);
    sessionTokenService = Mockito.mock(SessionTokenService.class);
    securityProperties = new SecurityProperties();
    securityProperties.setVerificationCode("888888");
    authService = new AuthService(authAccountMapper, sessionTokenService, securityProperties);
  }

  @Test
  void loginReturnsAccountBoundTokenForSeedSuperAdmin() {
    AuthAccount account = new AuthAccount();
    account.setId(1L);
    account.setIdentityId(11L);
    account.setClientCode("admin");
    account.setDisplayName("超级管理员");
    account.setPhone("15926626945");
    account.setStatus("enabled");
    account.setEmployeeId(1L);
    account.setTenantId(1L);
    account.setStoreId(1L);
    account.setDataPermission("all");
    when(authAccountMapper.findByPhone("15926626945")).thenReturn(account);
    when(authAccountMapper.findAdminRoleCodes(1L, 11L)).thenReturn(List.of("SUPER_ADMIN"));
    when(authAccountMapper.findAdminRoleNames(1L, 11L)).thenReturn(List.of("超级管理员"));
    when(authAccountMapper.findAdminPermissionValues(1L, 11L)).thenReturn(List.of("all"));
    when(sessionTokenService.issue(account)).thenReturn("opaque-session-token");

    LoginResponse response = authService.login(new LoginRequest("15926626945", "888888"));

    assertThat(response.token()).isEqualTo("opaque-session-token");
    assertThat(response.user().phone()).isEqualTo("15926626945");
    assertThat(response.user().roles()).contains("SUPER_ADMIN");
    assertThat(response.user().roleNames()).containsExactly("超级管理员");
    assertThat(response.user().permissions()).containsExactly("all");
    assertThat(response.user().dataPermission()).isEqualTo("all");
  }

  @Test
  void loginExpandsRoleFunctionPermissions() {
    AuthAccount account = new AuthAccount();
    account.setId(2L);
    account.setIdentityId(22L);
    account.setClientCode("admin");
    account.setDisplayName("测试员工");
    account.setPhone("15900000001");
    account.setStatus("enabled");
    account.setEmployeeId(3L);
    account.setTenantId(1L);
    account.setStoreId(1L);
    account.setDataPermission("self");
    when(authAccountMapper.findByPhone("15900000001")).thenReturn(account);
    when(authAccountMapper.findAdminRoleCodes(2L, 22L)).thenReturn(List.of("ADMIN_MANAGER"));
    when(authAccountMapper.findAdminRoleNames(2L, 22L)).thenReturn(List.of("管理员"));
    when(authAccountMapper.findAdminPermissionValues(2L, 22L))
        .thenReturn(List.of(
            "admin.permission-management.employee-management.query,"
                + "admin.permission-management.employee-management.reset,"
                + "admin.permission-management.employee-management.edit"));
    when(sessionTokenService.issue(account)).thenReturn("opaque-session-token");

    LoginResponse response = authService.login(new LoginRequest("15900000001", "888888"));

    assertThat(response.token()).isEqualTo("opaque-session-token");
    assertThat(response.user().name()).isEqualTo("测试员工");
    assertThat(response.user().roleNames()).containsExactly("管理员");
    assertThat(response.user().permissions())
        .containsExactly(
            "admin.permission-management.employee-management.view",
            "admin.permission-management.employee-management.edit");
    assertThat(response.user().employeeId()).isEqualTo(3L);
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
