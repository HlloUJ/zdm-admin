package com.zdm.platform.inventory;

import jakarta.validation.constraints.Size;

public record SlabDeleteRequest(
    @Size(max = 100, message = "删除原因不能超过100个字") String reason,
    @Size(max = 1000, message = "详细说明不能超过1000个字") String detail) {}
