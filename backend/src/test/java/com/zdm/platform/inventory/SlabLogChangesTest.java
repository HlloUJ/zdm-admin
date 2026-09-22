package com.zdm.platform.inventory;

import static org.assertj.core.api.Assertions.assertThat;
import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SlabLogChangesTest {
  private Map<String, Object> tier(int id, String coefficient, String price) {
    return Map.of("storeLevelId", id, "priceCoefficient", new BigDecimal(coefficient), "price", new BigDecimal(price));
  }
  @Test void ignoresNumericScaleAndUnchangedFields() {
    var result = SlabLogChanges.retainChanged(Map.of(
        "成本价", Map.of("before", new BigDecimal("10.00"), "after", 10),
        "大板名称", Map.of("before", "旧名称", "after", "新名称"),
        "1:1主图", Map.of("before", 12L, "after", 12)));
    assertThat(result).containsOnlyKeys("大板名称");
  }
  @Test void retainsOnlyChangedPriceTiersRegardlessOfOrderAndScale() {
    var changed = Map.of("before", List.of(tier(1,"1.10","11"),tier(2,"1.2","12")),
        "after", List.of(tier(2,"1.20","15"),tier(1,"1.1","11.00")));
    var result = SlabLogChanges.retainChanged(Map.of("价格层级", changed));
    assertThat(result).containsEntry("价格层级", Map.of("before",List.of(tier(2,"1.2","12")),"after",List.of(tier(2,"1.20","15"))));
  }
  @Test void preservesAddedRemovedAndCoefficientOnlyChanges() {
    var before = List.of(tier(1,"1","10"),tier(2,"2","20"));
    var after = List.of(tier(2,"3","20"),tier(3,"3","30"));
    assertThat(SlabLogChanges.retainChanged(Map.of("价格层级",Map.of("before",before,"after",after))))
        .containsEntry("价格层级",Map.of("before",before,"after",after));
  }
  @Test void preservesSourceOnlyChangesForNewAndHistoricalTierRecords() {
    var oldTier = new java.util.LinkedHashMap<String, Object>(tier(1,"1.1","11"));
    oldTier.put("storeLevelName", "一级");
    var newTier = new java.util.LinkedHashMap<String, Object>(oldTier);
    oldTier.put("priceSource", "auto");
    newTier.put("priceSource", "manual");
    var changes = new java.util.LinkedHashMap<String, Object>();
    changes.put("价格层级", Map.of("before", List.of(oldTier), "after", List.of(newTier)));
    assertThat(SlabLogChanges.retainChanged(changes)).containsKey("价格层级");
    oldTier.remove("priceSource");
    newTier.remove("priceSource");
    changes.put("一级价格来源", Map.of("before", "跟随配置", "after", "手工价格"));
    assertThat(SlabLogChanges.retainChanged(changes)).containsKeys("价格层级", "一级价格来源");
  }

}
