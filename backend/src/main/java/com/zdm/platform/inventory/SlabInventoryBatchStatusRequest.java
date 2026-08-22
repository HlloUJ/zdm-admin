package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

public record SlabInventoryBatchStatusRequest(
    @NotEmpty List<Long> ids,
    @NotBlank String status) {
}
