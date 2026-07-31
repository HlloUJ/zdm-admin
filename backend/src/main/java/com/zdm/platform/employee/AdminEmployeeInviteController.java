package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/employee-invites")
public class AdminEmployeeInviteController {
  private static final String CREATE_PERMISSION =
      "admin.permission-management.employee-management.create";

  private final EmployeeInviteService inviteService;
  private final PermissionGuard permissionGuard;

  public AdminEmployeeInviteController(EmployeeInviteService inviteService, PermissionGuard permissionGuard) {
    this.inviteService = inviteService;
    this.permissionGuard = permissionGuard;
  }

  @PostMapping
  public ApiResponse<EmployeeInviteResponse> create() {
    permissionGuard.requirePermission(CREATE_PERMISSION);
    return ApiResponse.ok(inviteService.createInvite());
  }
}
