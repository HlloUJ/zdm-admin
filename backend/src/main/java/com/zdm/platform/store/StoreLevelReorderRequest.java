package com.zdm.platform.store;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record StoreLevelReorderRequest(@NotEmpty List<@NotNull Long> orderedIds) {
  public StoreLevelReorderRequest {
    orderedIds = orderedIds == null ? null : List.copyOf(orderedIds);
  }

  @Override
  public List<Long> orderedIds() {
    return orderedIds == null ? null : List.copyOf(orderedIds);
  }
}
