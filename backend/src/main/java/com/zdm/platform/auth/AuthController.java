package com.zdm.platform.auth;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.SessionTokenService;
import jakarta.validation.Valid;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/auth")
public class AuthController {
  private final AuthService authService;
  private final SessionTokenService sessionTokenService;
  private final CurrentIdentityProvider identityProvider;

  public AuthController(
      AuthService authService,
      SessionTokenService sessionTokenService,
      CurrentIdentityProvider identityProvider) {
    this.authService = authService;
    this.sessionTokenService = sessionTokenService;
    this.identityProvider = identityProvider;
  }

  @PostMapping("/login")
  public ApiResponse<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
    return ApiResponse.ok(authService.login(request));
  }

  @PostMapping("/logout")
  public ApiResponse<Boolean> logout() {
    sessionTokenService.revoke(identityProvider.require().sessionId());
    return ApiResponse.ok(true);
  }
}
