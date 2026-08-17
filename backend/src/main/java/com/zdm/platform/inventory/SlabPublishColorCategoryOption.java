package com.zdm.platform.inventory;

import java.util.List;

public record SlabPublishColorCategoryOption(
    Long id,
    String label,
    String status,
    List<SlabPublishOption> children) {
  public SlabPublishColorCategoryOption {
    children = List.copyOf(children);
  }
}
