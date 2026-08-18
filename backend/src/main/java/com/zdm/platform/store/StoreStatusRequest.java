package com.zdm.platform.store;

import jakarta.validation.constraints.Pattern;

public record StoreStatusRequest(
    @Pattern(regexp = "enabled|disabled", message = "状态参数错误") String status) {}
