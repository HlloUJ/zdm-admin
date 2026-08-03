package com.zdm.platform.employee;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record EmployeePermissionUpdateRequest(
    @NotBlank
    String roleIds,
    @NotBlank
    @Pattern(regexp = "self|all", message = "数据权限无效")
    String dataPermission) {}
