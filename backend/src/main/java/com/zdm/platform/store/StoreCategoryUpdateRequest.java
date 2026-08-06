package com.zdm.platform.store;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record StoreCategoryUpdateRequest(
    @NotBlank @Size(max = 20) String name) {}
