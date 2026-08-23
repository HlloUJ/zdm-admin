package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record SlabColorStatusRequest(
    @NotBlank @Pattern(regexp = "enabled|disabled") String status) {}
