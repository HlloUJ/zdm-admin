package com.zdm.platform.security;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import com.zdm.platform.auth.AuthAccount;
import com.zdm.platform.auth.AuthAccountMapper;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;

class EffectivePermissionResolverTest {
  private AuthAccountMapper authAccountMapper;
  private EffectivePermissionResolver resolver;

  @BeforeEach
  void setUp() {
    authAccountMapper = Mockito.mock(AuthAccountMapper.class);
    resolver = new EffectivePermissionResolver(authAccountMapper);
  }

  @Test
  void storeEmployeePermissionsAreIntersectedWithTerminalScope() {
    AuthAccount account = employeeAccount(7L, 17L, 3L, "cityPartner");
    when(authAccountMapper.findAdminPermissionValues(7L, 17L)).thenReturn(List.of(
        "admin.permission-management.role-management.view,admin.supplier-management.view"));
    when(authAccountMapper.findTerminalPermissionValue("cityPartner")).thenReturn(
        "admin.permission-management.role-management.view");

    assertThat(resolver.resolve(account))
        .containsExactly("admin.permission-management.role-management.view");
  }

  @Test
  void platformEmployeeUsesCurrentRolePermissionsWithoutStoreTerminal() {
    AuthAccount account = employeeAccount(8L, 18L, null, null);
    when(authAccountMapper.findAdminPermissionValues(8L, 18L)).thenReturn(List.of(
        "admin.permission-management.employee-management.edit"));

    assertThat(resolver.resolve(account)).containsExactly(
        "admin.permission-management.employee-management.view",
        "admin.permission-management.employee-management.edit");
  }

  private AuthAccount employeeAccount(Long accountId, Long identityId, Long storeId, String storeType) {
    AuthAccount account = new AuthAccount();
    account.setId(accountId);
    account.setIdentityId(identityId);
    account.setIdentityType("employee");
    account.setStoreId(storeId);
    account.setStoreType(storeType);
    return account;
  }
}
