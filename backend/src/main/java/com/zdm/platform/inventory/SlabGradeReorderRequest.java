package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record SlabGradeReorderRequest(
    @NotEmpty List<@NotNull Long> orderedIds) {
  public SlabGradeReorderRequest {
    orderedIds = orderedIds == null ? null : List.copyOf(orderedIds);
  }

  @Override
  public List<Long> orderedIds() {
    return orderedIds == null ? null : List.copyOf(orderedIds);
  }
}
