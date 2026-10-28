package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.jdbc.core.JdbcTemplate;

class ArrivalLogPriceTiersTest {
  @ParameterizedTest
  @ValueSource(strings = {"finished", "accessory", "slab"})
  void recordsMissingTiersWithoutChangingSavedPricesOrWritingPrices(String kind) {
    JdbcTemplate jdbc = mock(JdbcTemplate.class);
    Map<String, Object> missing = new LinkedHashMap<>();
    missing.put("id", 25L);
    missing.put("name", "华东中心店");
    missing.put("configuration_status", null);
    when(jdbc.queryForList(anyString())).thenReturn(List.of(missing,
        Map.of("id", 26L, "name", "停用配置级别", "configuration_status", "disabled")));
    Map<String, Object> saved = Map.of("storeLevelId", 26, "storeLevelName", "历史名称",
        "skuId", 11L, "priceCoefficient", 2, "price", 20, "priceSource", "manual");
    boolean slab = "slab".equals(kind);
    var result = ArrivalLogPriceTiers.complete(jdbc, kind, List.of(saved), slab ? List.of() : List.of(11L, 12L));
    assertThat(result.getFirst()).isSameAs(saved);
    assertThat(result).hasSize(slab ? 2 : 4);
    assertThat(result.get(1)).containsEntry("storeLevelName", "华东中心店")
        .containsEntry("missingReason", "未配置价格系数，未生成价格")
        .containsEntry("price", null).containsEntry("priceCoefficient", null)
        .doesNotContainKey("priceSource");
    if (!slab) {
      assertThat(result.get(1)).containsEntry("skuId", 11L);
      assertThat(result.get(2)).containsEntry("skuId", 12L);
      assertThat(result.get(3)).containsEntry("skuId", 12L)
          .containsEntry("missingReason", "价格配置已停用，未生成价格");
    }
    verify(jdbc).queryForList(anyString());
    verifyNoMoreInteractions(jdbc);
  }
}
