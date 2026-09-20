package com.zdm.platform.employee;

public record EmployeeInviteVerifyResponse(
    boolean requiresProfile, EmployeeInviteRegisterResponse registration) {}
