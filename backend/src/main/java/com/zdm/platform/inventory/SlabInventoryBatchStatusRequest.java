package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record SlabInventoryBatchStatusRequest(
    @NotEmpty List<Long> ids,
    @NotBlank String status,
    String reason,
    String detail,
    String operation) {
  public SlabInventoryBatchStatusRequest(List<Long> ids, String status, String reason, String detail) {
    this(ids, status, reason, detail, null);
  }
  public SlabInventoryBatchStatusRequest {
    ids = List.copyOf(ids);
  }
}
