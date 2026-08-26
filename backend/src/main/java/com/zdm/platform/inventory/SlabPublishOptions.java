package com.zdm.platform.inventory;

import java.util.List;

public record SlabPublishOptions(
    List<SlabPublishOption> varieties,
    List<SlabPublishOption> origins,
    List<SlabPublishOption> textures,
    List<SlabPublishColorCategoryOption> colorCategories,
    List<SlabPublishOption> grades,
    List<SlabPublishOption> suppliers,
    List<SlabPublishOption> storeLevels) {
  public SlabPublishOptions {
    varieties = List.copyOf(varieties);
    origins = List.copyOf(origins);
    textures = List.copyOf(textures);
    colorCategories = List.copyOf(colorCategories);
    grades = List.copyOf(grades);
    suppliers = List.copyOf(suppliers);
    storeLevels = List.copyOf(storeLevels);
  }
}
