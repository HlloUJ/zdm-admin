package com.zdm.platform.store;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record StoreCategoryMoveRequest(
    @NotBlank @Pattern(regexp = "up|down") String direction) {}
