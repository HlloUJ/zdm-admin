package com.zdm.platform.inventory;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;

/** Adds missing tier slots only to new arrival logs; never writes product prices. */
final class ArrivalLogPriceTiers {
  private ArrivalLogPriceTiers() {}

  static List<Map<String, Object>> complete(JdbcTemplate jdbc, String kind,
      List<Map<String, Object>> prices, List<Long> skuIds) {
    if (!List.of("finished", "accessory", "slab").contains(kind)) {
      throw new IllegalArgumentException("未知商品类型");
    }
    var levels = jdbc.queryForList("SELECT l.id,l.name,c.status AS configuration_status FROM store_levels l "
        + "LEFT JOIN " + kind + "_markup_configurations c ON c.store_level_id=l.id "
        + "WHERE l.status='enabled' OR EXISTS (SELECT 1 FROM stores s WHERE s.store_level_id=l.id) ORDER BY l.id");
    List<Map<String, Object>> result = new ArrayList<>(prices);
    // Slabs have no SKU dimension. Keep actual saved rows and names unchanged.
    List<Long> slots = skuIds.isEmpty() ? java.util.Collections.singletonList(null) : skuIds;
    for (var level : levels) {
      for (Long skuId : slots) {
        boolean recorded = prices.stream().anyMatch(price -> sameId(price.get("storeLevelId"), level.get("id"))
            && (skuId == null || sameId(price.get("skuId"), skuId)));
        if (recorded) { continue; }
        Map<String, Object> missing = new LinkedHashMap<>();
        missing.put("storeLevelId", level.get("id"));
        missing.put("storeLevelName", level.get("name"));
        if (skuId != null) { missing.put("skuId", skuId); }
        missing.put("priceCoefficient", null);
        missing.put("price", null);
        missing.put("missingReason", "disabled".equals(level.get("configuration_status"))
            ? "价格配置已停用，未生成价格" : "未配置价格系数，未生成价格");
        result.add(missing);
      }
    }
    return result;
  }

  private static boolean sameId(Object left, Object right) {
    return left instanceof Number a && right instanceof Number b && a.longValue() == b.longValue();
  }
}
