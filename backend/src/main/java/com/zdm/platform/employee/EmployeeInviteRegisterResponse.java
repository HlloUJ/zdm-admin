package com.zdm.platform.employee;

public record EmployeeInviteRegisterResponse(
    Long employeeId, String status, boolean existingAccount, boolean existingEmployee, boolean canLogin,
    String identityType) {
  public EmployeeInviteRegisterResponse(Long employeeId, String status, boolean existingAccount,
      boolean existingEmployee, boolean canLogin) {
    this(employeeId, status, existingAccount, existingEmployee, canLogin, "employee");
  }
}
