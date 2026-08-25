package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
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
        mapper, identityProvider, Mockito.mock(PriceConfigurationBackfillService.class));

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
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectList(any())).thenReturn(List.of(otherCreatorConfiguration));
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThat(service.listConfigurations(false))
        .extracting(SlabMarkupConfiguration::getCreatedByAccountId)
        .containsExactly(99L);
  }

  @Test
  void selfDataPermissionCanOperateConfigurationCreatedByAnotherAccount() {
    SlabMarkupConfigurationMapper mapper = Mockito.mock(SlabMarkupConfigurationMapper.class);
    CurrentIdentityProvider identityProvider = Mockito.mock(CurrentIdentityProvider.class);
    SlabMarkupConfiguration otherCreatorConfiguration = new SlabMarkupConfiguration();
    otherCreatorConfiguration.setId(21L);
    otherCreatorConfiguration.setName("其他员工添加");
    otherCreatorConfiguration.setStatus("enabled");
    otherCreatorConfiguration.setCreatedByAccountId(99L);
    when(identityProvider.require()).thenReturn(platformIdentityWithSelfDataPermission());
    when(mapper.selectById(21L)).thenReturn(otherCreatorConfiguration);
    SlabMarkupConfigurationService service = new SlabMarkupConfigurationService(
        mapper, identityProvider, Mockito.mock(PriceConfigurationBackfillService.class));

    assertThat(service.updateStatus(21L, "disabled").getStatus()).isEqualTo("disabled");
    service.deleteConfiguration(21L);
    verify(mapper).deleteById(21L);
  }
}
