package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.common.StoreLevelPricingDirectory;
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
        mapper, identityProvider, Mockito.mock(StoreLevelPricingDirectory.class));

    assertThatThrownBy(() -> service.listConfigurations(false))
        .isInstanceOf(AccessDeniedException.class)
        .hasMessage("仅运营管理平台可以维护加价配置");
    verifyNoInteractions(mapper);
  }

  @Test
  void selfDataPermissionStillReadsConfigurationsCreatedByOtherAccounts() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    SlabMarkupConfiguration otherCreatorConfiguration = new SlabMarkupConfiguration();
    otherCreatorConfiguration.setId(21L);
    otherCreatorConfiguration.setStoreLevelId(1L);
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(otherCreatorConfiguration));
    StoreLevelPricingDirectory storeLevelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    StoreLevelPricingDirectory.Level level = new StoreLevelPricingDirectory.Level(1L, "核心合作店", 1);
    when(storeLevelDirectory.findLevel(1L)).thenReturn(level);
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, storeLevelDirectory);

    assertThat(service.listConfigurations(false))
        .extracting(SlabMarkupConfiguration::getCreatedByAccountId)
        .containsExactly(99L);
  }

  @Test
  void selfDataPermissionCanDeleteConfigurationCreatedByAnotherAccount() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    SlabMarkupConfiguration otherCreatorConfiguration = new SlabMarkupConfiguration();
    otherCreatorConfiguration.setId(21L);
    otherCreatorConfiguration.setStoreLevelId(1L);
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setStatus("enabled");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectById(21L)).thenReturn(otherCreatorConfiguration);
    StoreLevelPricingDirectory storeLevelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    StoreLevelPricingDirectory.Level level = new StoreLevelPricingDirectory.Level(1L, "核心合作店", 1);
    when(storeLevelDirectory.findLevel(1L)).thenReturn(level);
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, storeLevelDirectory);

    service.deleteConfiguration(21L);
    verify(mapper).deleteById(21L);
  }

  @Test
  void finishedConfigurationsCanPersistIndependentDragOrder() {
    FinishedMarkupConfigurationMapper mapper = Mockito.mock(FinishedMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    FinishedMarkupConfiguration first = finishedConfiguration(31L, 1L, 1);
    FinishedMarkupConfiguration second = finishedConfiguration(32L, 2L, 2);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(first, second));
    StoreLevelPricingDirectory storeLevelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    when(storeLevelDirectory.findLevel(1L)).thenReturn(new StoreLevelPricingDirectory.Level(1L, "一级店", 10));
    when(storeLevelDirectory.findLevel(2L)).thenReturn(new StoreLevelPricingDirectory.Level(2L, "二级店", 20));
    FinishedMarkupConfigurationService service = new FinishedMarkupConfigurationService(
        mapper, identityProvider, storeLevelDirectory);

    service.reorderConfigurations(List.of(32L, 31L));

    assertThat(first.getSortOrder()).isEqualTo(2);
    assertThat(second.getSortOrder()).isEqualTo(1);
    verify(mapper).updateById(first);
    verify(mapper).updateById(second);
  }

  @Test
  void slabConfigurationsCanPersistIndependentDragOrder() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    SlabMarkupConfiguration first = slabConfiguration(41L, 1L, 1);
    SlabMarkupConfiguration second = slabConfiguration(42L, 2L, 2);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(first, second));
    StoreLevelPricingDirectory storeLevelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    when(storeLevelDirectory.findLevel(1L)).thenReturn(new StoreLevelPricingDirectory.Level(1L, "一级店", 10));
    when(storeLevelDirectory.findLevel(2L)).thenReturn(new StoreLevelPricingDirectory.Level(2L, "二级店", 20));
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, storeLevelDirectory);

    service.reorderConfigurations(List.of(42L, 41L));

    assertThat(first.getSortOrder()).isEqualTo(2);
    assertThat(second.getSortOrder()).isEqualTo(1);
    verify(mapper).updateById(first);
    verify(mapper).updateById(second);
  }

  private static FinishedMarkupConfiguration finishedConfiguration(
      Long id, Long storeLevelId, int sortOrder) {
    FinishedMarkupConfiguration configuration = new FinishedMarkupConfiguration();
    configuration.setId(id);
    configuration.setStoreLevelId(storeLevelId);
    configuration.setSortOrder(sortOrder);
    configuration.setLegacySeeded(false);
    return configuration;
  }

  private static SlabMarkupConfiguration slabConfiguration(Long id, Long storeLevelId, int sortOrder) {
    SlabMarkupConfiguration configuration = new SlabMarkupConfiguration();
    configuration.setId(id);
    configuration.setStoreLevelId(storeLevelId);
    configuration.setSortOrder(sortOrder);
    configuration.setLegacySeeded(false);
    return configuration;
  }
}
