package com.zdm.platform.store;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record StoreCategoryCreateRequest(
    @NotBlank @Pattern(regexp = "finished|accessory") String scope,
    Long parentId,
    @NotBlank @Size(max = 20) String name,
    @NotBlank @Pattern(regexp = "enabled|disabled") String status) {}
