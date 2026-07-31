package com.zdm.platform.craft;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record CraftStatusRequest(
    @NotBlank
    @Pattern(regexp = "enabled|disabled", message = "状态无效")
    String status) {}
