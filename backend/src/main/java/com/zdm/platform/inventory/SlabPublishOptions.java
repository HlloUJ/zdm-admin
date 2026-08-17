package com.zdm.platform.inventory;

import java.util.List;

public record SlabPublishOptions(
    List<SlabPublishOption> textures,
    List<SlabPublishColorCategoryOption> colorCategories,
    List<SlabPublishOption> grades) {
  public SlabPublishOptions {
    textures = List.copyOf(textures);
    colorCategories = List.copyOf(colorCategories);
    grades = List.copyOf(grades);
  }
}
