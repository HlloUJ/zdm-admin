package com.zdm.platform.employee;

public record EmployeeInviteRegisterResponse(
    Long employeeId, String status, boolean existingAccount, boolean existingEmployee, boolean canLogin) {}
