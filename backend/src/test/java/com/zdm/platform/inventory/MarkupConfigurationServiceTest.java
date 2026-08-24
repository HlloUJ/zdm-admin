package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.security.access.AccessDeniedException;

class MarkupConfigurationServiceTest {
  private static CurrentIdentity platformIdentityWithSelfDataPermission() {
    return new CurrentIdentity(
        11L,
        11L,
        11L,
        11L,
        "admin",
        null,
        null,
        "运营员工",
        "self",
        List.of("MARKUP_OPERATOR"),
        List.of("admin.product-data-center.markup-configuration.finished.view"));
  }

  @Test
  void storeIdentityCannotReadPlatformMarkupConfiguration() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    CreatorOwnershipGuard ownershipGuard = Mockito.mock(CreatorOwnershipGuard.class);
    when(identityProvider.require()).thenReturn(new CurrentIdentity(
        10L,
        10L,
        10L,
        10L,
        "store",
        2L,
        3L,
        "门店管理员",
        "all",
        List.of("STORE_ADMIN"),
        List.of("all")));
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, ownershipGuard, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThatThrownBy(() -> service.listConfigurations(false))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage("仅运营管理平台可以维护加价配置");
    verifyNoInteractions(mapper);
  }

  @Test
  void selfDataPermissionStillReadsConfigurationsCreatedByOtherAccounts() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    CreatorOwnershipGuard ownershipGuard = Mockito.mock(CreatorOwnershipGuard.class);
    SlabMarkupConfiguration otherCreatorConfiguration = new SlabMarkupConfiguration();
    otherCreatorConfiguration.setId(21L);
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(otherCreatorConfiguration));
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, ownershipGuard, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThat(service.listConfigurations(false))
        .extracting(SlabMarkupConfiguration::getCreatedByAccountId)
        .containsExactly(99L);
    verifyNoInteractions(ownershipGuard);
  }

  @Test
  void operationsRequireCreatorOwnership() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    CreatorOwnershipGuard ownershipGuard = Mockito.mock(CreatorOwnershipGuard.class);
    SlabMarkupConfiguration otherCreatorConfiguration = new SlabMarkupConfiguration();
    otherCreatorConfiguration.setId(21L);
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectById(21L)).thenReturn(otherCreatorConfiguration);
    doThrow(new AccessDeniedException(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE))
        .when(ownershipGuard)
        .requireCreator(99L, null);
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, ownershipGuard, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThatThrownBy(() -> service.updateConfiguration(21L, new SlabMarkupConfiguration()))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
    assertThatThrownBy(() -> service.updateStatus(21L, "disabled"))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
    assertThatThrownBy(() -> service.deleteConfiguration(21L))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
    verify(ownershipGuard, times(3)).requireCreator(99L, null);
  }

  @Test
  void reorderRequiresOwnershipOfEveryConfiguration() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    CreatorOwnershipGuard ownershipGuard = Mockito.mock(CreatorOwnershipGuard.class);
    SlabMarkupConfiguration ownConfiguration = new SlabMarkupConfiguration();
    ownConfiguration.setId(21L);
    ownConfiguration.setCreatedByAccountId(11L);
    SlabMarkupConfiguration otherConfiguration = new SlabMarkupConfiguration();
    otherConfiguration.setId(22L);
    otherConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(ownConfiguration, otherConfiguration));
    doThrow(new AccessDeniedException(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE))
        .when(ownershipGuard)
        .requireCreator(99L, null);
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, ownershipGuard, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThatThrownBy(() -> service.reorderConfigurations(List.of(22L, 21L)))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage(CreatorOwnershipGuard.OTHER_CREATOR_MESSAGE);
    verify(mapper, never()).updateById(any(SlabMarkupConfiguration.class));
  }
}
