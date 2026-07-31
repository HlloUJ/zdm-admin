package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/open/employee-invites")
public class OpenEmployeeInviteController {
  private final EmployeeInviteService inviteService;

  public OpenEmployeeInviteController(EmployeeInviteService inviteService) {
    this.inviteService = inviteService;
  }

  @GetMapping("/{token}")
  public ApiResponse<EmployeeInviteResponse> inspect(@PathVariable String token) {
    return ApiResponse.ok(inviteService.inspectInvite(token));
  }

  @PostMapping("/{token}/request-code")
  public ApiResponse<Boolean> requestCode(
      @PathVariable String token,
      @Valid @RequestBody RequestInviteCodeRequest request) {
    return ApiResponse.ok(inviteService.requestCode(token, request));
  }

  @PostMapping("/{token}/verify-code")
  public ApiResponse<Boolean> verifyCode(
      @PathVariable String token,
      @Valid @RequestBody VerifyInviteCodeRequest request) {
    return ApiResponse.ok(inviteService.verifyCode(token, request));
  }

  @PostMapping("/{token}/register")
  public ApiResponse<EmployeeInviteRegisterResponse> register(
      @PathVariable String token,
      @Valid @RequestBody EmployeeInviteRegisterRequest request) {
    return ApiResponse.ok(inviteService.register(token, request));
  }
}
