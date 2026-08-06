package com.zdm.platform.store;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record StoreCategoryStatusRequest(
    @NotBlank @Pattern(regexp = "enabled|disabled") String status) {}
