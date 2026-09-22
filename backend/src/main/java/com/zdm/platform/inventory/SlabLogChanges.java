package com.zdm.platform.inventory;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

final class SlabLogChanges {
  private SlabLogChanges() {}

  static boolean same(Object before, Object after) {
    if (before instanceof Number left && after instanceof Number right) {
      return new BigDecimal(left.toString()).compareTo(new BigDecimal(right.toString())) == 0;
    }
    if (before instanceof Map<?, ?> left && after instanceof Map<?, ?> right) {
      return left.keySet().equals(right.keySet()) && left.keySet().stream().allMatch(key -> same(left.get(key), right.get(key)));
    }
    if (before instanceof List<?> left && after instanceof List<?> right) {
      if (left.size() != right.size()) { return false; }
      for (int i = 0; i < left.size(); i++) {
        if (!same(left.get(i), right.get(i))) { return false; }
      }
      return true;
    }
    return Objects.equals(before, after);
  }

  static Map<String, Object> retainChanged(Map<String, ?> changes) {
    Map<String, Object> result = new LinkedHashMap<>();
    changes.forEach((field, raw) -> {
      if (!(raw instanceof Map<?, ?> change)) { return; }
      Object before = change.get("before"), after = change.get("after");
      if ("价格层级".equals(field) && before instanceof List<?> oldTiers && after instanceof List<?> newTiers) {
        var oldById = tiersById(oldTiers);
        var newById = tiersById(newTiers);
        var keys = new java.util.LinkedHashSet<>(oldById.keySet());
        keys.addAll(newById.keySet());
        List<Object> changedBefore = new ArrayList<>(), changedAfter = new ArrayList<>();
        for (Object key : keys) {
          var oldTier = oldById.get(key);
          var newTier = newById.get(key);
          if (oldTier != null && newTier != null
              && same(oldTier.get("price"), newTier.get("price"))
              && same(oldTier.get("priceCoefficient"), newTier.get("priceCoefficient"))
              && same(oldTier.get("markupRate"), newTier.get("markupRate"))
              && same(oldTier.get("priceSource"), newTier.get("priceSource"))
              && !sourceChanged(changes.get(newTier.get("storeLevelName") + "价格来源"))) { continue; }
          if (oldTier != null) { changedBefore.add(oldTier); }
          if (newTier != null) { changedAfter.add(newTier); }
        }
        before = changedBefore;
        after = changedAfter;
      }
      if (same(before, after) && !("价格层级".equals(field) && before instanceof List<?> tiers && !tiers.isEmpty())) { return; }
      var values = new LinkedHashMap<String, Object>();
      values.put("before", before);
      values.put("after", after);
      result.put(field, values);
    });
    return result;
  }

  private static boolean sourceChanged(Object raw) {
    return raw instanceof Map<?, ?> change && !same(change.get("before"), change.get("after"));
  }

  private static Map<Object, Map<?, ?>> tiersById(List<?> tiers) {
    Map<Object, Map<?, ?>> result = new LinkedHashMap<>();
    for (Object raw : tiers) {
      if (!(raw instanceof Map<?, ?> tier)) { continue; }
      Object id = tier.containsKey("storeLevelId") ? tier.get("storeLevelId") : tier.get("configurationId");
      result.put(id == null ? tier.get("storeLevelName") : id.toString(), tier);
    }
    return result;
  }
}
