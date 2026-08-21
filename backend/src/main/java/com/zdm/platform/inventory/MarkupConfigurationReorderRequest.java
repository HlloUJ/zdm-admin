package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record MarkupConfigurationReorderRequest(
    @NotBlank String productType,
    @NotEmpty List<@NotNull Long> orderedIds) {
  public MarkupConfigurationReorderRequest {
    orderedIds = orderedIds == null ? null : List.copyOf(orderedIds);
  }

  @Override
  public List<Long> orderedIds() {
    return orderedIds == null ? null : List.copyOf(orderedIds);
  }
}
