package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class FinishedProductPriceServiceTest {
  @Test
  void acceptsPriceCoefficientBelowOne() {
    FinishedProductPriceMapper mapper = Mockito.mock(FinishedProductPriceMapper.class);
    FinishedMarkupConfigurationService configurationService =
        Mockito.mock(FinishedMarkupConfigurationService.class);
    FinishedMarkupConfiguration configuration = new FinishedMarkupConfiguration();
    configuration.setId(1L);
    when(configurationService.listConfigurations(true)).thenReturn(List.of(configuration));

    FinishedProductPrice requested = new FinishedProductPrice();
    requested.setMarkupConfigurationId(1L);
    requested.setVariantKey("SKU-A");
    requested.setPriceCoefficient(new BigDecimal("0.50"));
    requested.setCostPrice(new BigDecimal("100.00"));
    requested.setPrice(new BigDecimal("50.00"));

    new FinishedProductPriceService(mapper, configurationService)
        .replacePrices(10L, List.of(requested));

    ArgumentCaptor<FinishedProductPrice> captor = ArgumentCaptor.forClass(FinishedProductPrice.class);
    verify(mapper).insert(captor.capture());
    assertThat(captor.getValue().getPriceCoefficient()).isEqualByComparingTo("0.5000");
    assertThat(captor.getValue().getPrice()).isEqualByComparingTo("50.00");
    verify(mapper).delete(any());
  }
}
