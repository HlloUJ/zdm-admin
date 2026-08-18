package com.zdm.platform.tenant;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record TenantStatusUpdateRequest(
    @NotBlank
    @Pattern(regexp = "enabled|disabled")
    String status) {}
