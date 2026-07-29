package com.zdm.platform.employee;

import java.time.LocalDateTime;

public record EmployeeInviteResponse(String token, LocalDateTime expiresAt) {}
