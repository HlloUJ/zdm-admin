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
        2L, 2L, 2L, 2L, "admin", 1L, 1L, "同名员工", "all",
        List.of("SUPER_ADMIN"), List.of("all")));
  }

  @Test
  void accountIdIsAuthoritativeEvenForSuperAdminWithSameDisplayName() {
    assertThatThrownBy(() -> ownershipGuard.requireCreator(3L, "同名员工"))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
  }

  @Test
  void legacyRowsFallBackToDisplayNameWhenCreatorAccountIsMissing() {
    ownershipGuard.requireCreator(null, "同名员工");
  }
}
