package com.zdm.platform.tenant;

import jakarta.validation.constraints.NotBlank;

public record TenantPurgeRequest(@NotBlank String confirmationName) {}
