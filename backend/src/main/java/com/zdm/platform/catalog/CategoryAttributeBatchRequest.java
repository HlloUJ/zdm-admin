package com.zdm.platform.catalog;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record CategoryAttributeBatchRequest(
    @NotNull
    Long categoryId,
    @NotEmpty
    List<@NotNull Long> attributeIds) {
  public CategoryAttributeBatchRequest {
    attributeIds = List.copyOf(attributeIds);
  }
}
