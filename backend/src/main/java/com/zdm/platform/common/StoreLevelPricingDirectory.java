package com.zdm.platform.common;

public interface StoreLevelPricingDirectory {
  record Level(Long id, String name, Integer sortOrder) {}

  Level requireEnabledLevel(Long id);

  Level findLevel(Long id);
}
