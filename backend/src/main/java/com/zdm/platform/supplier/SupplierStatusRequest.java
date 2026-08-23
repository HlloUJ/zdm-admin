package com.zdm.platform.supplier;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record SupplierStatusRequest(
    @NotBlank
    @Pattern(regexp = "enabled|disabled", message = "状态无效")
    String status) {}
