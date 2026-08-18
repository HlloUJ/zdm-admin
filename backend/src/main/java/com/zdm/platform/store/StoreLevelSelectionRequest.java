package com.zdm.platform.store;

import jakarta.validation.constraints.NotNull;

public record StoreLevelSelectionRequest(
    @NotNull(message = "请选择店铺级别") Long storeLevelId) {}
