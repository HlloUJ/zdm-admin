package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.zdm.platform.common.StoreLevelPricingDirectory;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mockito;

class SlabPriceServiceTest {
  @Test
  void acceptsEnabledStoreLevelWithoutMarkupConfiguration() {
    SlabPriceMapper mapper = Mockito.mock(SlabPriceMapper.class);
    StoreLevelPricingDirectory levelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    when(mapper.selectList(any())).thenReturn(List.of());
    when(levelDirectory.listEnabledLevels())
        .thenReturn(List.of(new StoreLevelPricingDirectory.Level(7L, "社区合作店", 1)));
    SlabPrice requested = price(7L, "0.80", "100.00", "80.00");

    new SlabPriceService(mapper, levelDirectory).replacePrices(10L, List.of(requested));

    ArgumentCaptor<SlabPrice> captor = ArgumentCaptor.forClass(SlabPrice.class);
    verify(mapper).insert(captor.capture());
    assertThat(captor.getValue().getStoreLevelName()).isEqualTo("社区合作店");
    assertThat(captor.getValue().getPriceCoefficient()).isEqualByComparingTo("0.8000");
    assertThat(captor.getValue().getPrice()).isEqualByComparingTo("80.00");
  }

  @Test
  void preservesHistoricalSnapshotAndRequiresNewEnabledLevel() {
    SlabPriceMapper mapper = Mockito.mock(SlabPriceMapper.class);
    StoreLevelPricingDirectory levelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    SlabPrice historical = price(9L, "1.20", "100.00", "120.00");
    historical.setStoreLevelName("已停用历史级别");
    when(mapper.selectList(any())).thenReturn(List.of(historical));
    when(levelDirectory.listEnabledLevels())
        .thenReturn(List.of(new StoreLevelPricingDirectory.Level(7L, "当前门店级别", 1)));

    SlabPriceService service = new SlabPriceService(mapper, levelDirectory);
    assertThatThrownBy(() -> service.replacePrices(10L, List.of(historical)))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("必须填写全部展示的门店级别价格");

    service.replacePrices(10L, List.of(historical, price(7L, "0.80", "100.00", "80.00")));

    ArgumentCaptor<SlabPrice> captor = ArgumentCaptor.forClass(SlabPrice.class);
    verify(mapper, Mockito.times(2)).insert(captor.capture());
    assertThat(captor.getAllValues())
        .extracting(SlabPrice::getStoreLevelName)
        .containsExactly("已停用历史级别", "当前门店级别");
  }

  @Test
  void rejectsZeroCoefficient() {
    SlabPriceMapper mapper = Mockito.mock(SlabPriceMapper.class);
    StoreLevelPricingDirectory levelDirectory = Mockito.mock(StoreLevelPricingDirectory.class);
    when(mapper.selectList(any())).thenReturn(List.of());
    when(levelDirectory.listEnabledLevels())
        .thenReturn(List.of(new StoreLevelPricingDirectory.Level(7L, "社区合作店", 1)));

    assertThatThrownBy(() -> new SlabPriceService(mapper, levelDirectory)
        .replacePrices(10L, List.of(price(7L, "0.00", "100.00", "0.00"))))
        .isInstanceOf(IllegalArgumentException.class)
        .hasMessage("价格系数必须大于0，成本价和价格不能为空且不能小于0");
  }

  private static SlabPrice price(Long storeLevelId, String coefficient, String cost, String price) {
    SlabPrice requested = new SlabPrice();
    requested.setStoreLevelId(storeLevelId);
    requested.setPriceCoefficient(new BigDecimal(coefficient));
    requested.setCostPrice(new BigDecimal(cost));
    requested.setPrice(new BigDecimal(price));
    return requested;
  }
}
