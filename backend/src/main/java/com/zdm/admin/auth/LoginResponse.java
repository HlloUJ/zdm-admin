package com.zdm.admin.auth;

import java.util.List;

public record LoginResponse(String token, LoginUser user) {
  public record LoginUser(Long id, String name, String phone, List<String> roles, List<String> permissions) {}
}
