package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/employee-invites")
public class AdminEmployeeInviteController {
  private final EmployeeInviteService inviteService;

  public AdminEmployeeInviteController(EmployeeInviteService inviteService) {
    this.inviteService = inviteService;
  }

  @PostMapping
  public ApiResponse<EmployeeInviteResponse> create() {
    return ApiResponse.ok(inviteService.createInvite());
  }
}
