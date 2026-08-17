package com.zdm.platform.security;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;

class CreatorOwnershipGuardTest {
  private CurrentIdentityProvider identityProvider;
  private CreatorOwnershipGuard ownershipGuard;

  @BeforeEach
  void setUp() {
    identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    ownershipGuard = new CreatorOwnershipGuard(identityProvider);
    when(identityProvider.require()).thenReturn(new CurrentIdentity(
        2L, 2L, 2L, 2L, "admin", 1L, 1L, "同名员工", "self",
        List.of("ADMIN"), List.of("admin.product-data-center.attribute.shared.edit")));
  }

  @Test
  void accountIdIsAuthoritativeForRegularAccountsWithSameDisplayName() {
    assertThatThrownBy(() -> ownershipGuard.requireCreator(3L, "同名员工"))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
  }

  @Test
  void superAdminCanOperateDataCreatedByAnotherAccount() {
    when(identityProvider.require()).thenReturn(new CurrentIdentity(
        1L, 1L, 1L, 1L, "admin", 1L, 1L, "超级管理员", "all",
        List.of("SUPER_ADMIN"), List.of("all")));

    ownershipGuard.requireCreator(3L, "其他管理员");
  }

  @Test
  void legacyRowsFallBackToDisplayNameWhenCreatorAccountIsMissing() {
    ownershipGuard.requireCreator(null, "同名员工");
  }
}
