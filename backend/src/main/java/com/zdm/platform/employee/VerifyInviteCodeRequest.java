package com.zdm.platform.employee;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;

public record VerifyInviteCodeRequest(
    @NotBlank @Pattern(regexp = "^1[3-9]\\d{9}$") String phone,
    @NotBlank @Pattern(regexp = "^\\d{6}$") String verifyCode) {}
