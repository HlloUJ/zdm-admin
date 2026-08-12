package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record SlabTextureStatusRequest(
    @NotBlank @Pattern(regexp = "enabled|disabled", message = "状态无效") String status) {}
