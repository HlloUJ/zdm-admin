package com.zdm.platform.catalog;

import jakarta.validation.constraints.NotNull;
import java.util.List;

public record CategoryAttributeValueBindingRequest(@NotNull List<@NotNull Long> valueIds) {
  public CategoryAttributeValueBindingRequest {
    valueIds = valueIds == null ? null : List.copyOf(valueIds);
  }
}
