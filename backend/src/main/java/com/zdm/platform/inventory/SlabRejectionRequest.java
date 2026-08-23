package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SlabRejectionRequest(
    @NotBlank @Size(max = 100) String reason,
    @NotBlank @Size(max = 1000) String detail) {
}
