package com.zdm.platform.store;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.util.List;

public record StoreCategorySortRequest(
    @NotBlank @Pattern(regexp = "finished|accessory") String scope,
    Long parentId,
    @NotEmpty List<@NotNull Long> orderedIds) {
  public StoreCategorySortRequest {
    orderedIds = orderedIds == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(orderedIds));
  }

  @Override
  public List<Long> orderedIds() {
    return orderedIds == null ? null : java.util.Collections.unmodifiableList(new java.util.ArrayList<>(orderedIds));
  }
}
