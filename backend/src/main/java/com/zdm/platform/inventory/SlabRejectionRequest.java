package com.zdm.platform.inventory;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record SlabRejectionRequest(
    @NotBlank(message = "请选择驳回原因")
    @Size(max = 100, message = "驳回原因不能超过100个字")
    String reason,
    @NotBlank(message = "请输入详细说明")
    @Size(max = 1000, message = "详细说明不能超过1000个字")
    String detail) {}
