package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record AccessoryMarkupConfigurationReorderRequest(
    @NotEmpty List<@NotNull Long> orderedIds) {
  public AccessoryMarkupConfigurationReorderRequest {
    orderedIds = orderedIds == null ? null : List.copyOf(orderedIds);
  }

  @Override
  public List<Long> orderedIds() {
    return orderedIds == null ? null : List.copyOf(orderedIds);
  }
}
