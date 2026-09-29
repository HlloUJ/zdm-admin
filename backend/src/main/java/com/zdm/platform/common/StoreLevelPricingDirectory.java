package com.zdm.platform.common;

import java.util.List;

public interface StoreLevelPricingDirectory {
  record Level(Long id, String name, Integer sortOrder) {}

  Level requireEnabledLevel(Long id);

  Level findLevel(Long id);

  List<Level> listEnabledLevels();

  /** Levels used for current pricing: enabled levels and levels assigned to existing stores. */
  default List<Level> listOperationalPricingLevels() {
    return listEnabledLevels();
  }

  default Level requireOperationalPricingLevel(Long id) {
    return listOperationalPricingLevels().stream()
        .filter(level -> level.id().equals(id))
        .findFirst()
        .orElseThrow(() -> new IllegalArgumentException("门店级别不存在或已停用"));
  }
}
