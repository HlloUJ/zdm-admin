package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
import com.zdm.platform.security.PermissionGuard;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/employees")
public class EmployeeController {
  private static final String PERMISSION_PREFIX = "admin.permission-management.employee-management";

  private final EmployeeService employeeService;
  private final PermissionGuard permissionGuard;

  public EmployeeController(EmployeeService employeeService, PermissionGuard permissionGuard) {
    this.employeeService = employeeService;
    this.permissionGuard = permissionGuard;
  }

  @GetMapping
  public ApiResponse<List<Employee>> list() {
    permissionGuard.requireView(PERMISSION_PREFIX);
    return ApiResponse.ok(employeeService.listForCurrentAdmin());
  }

  @PostMapping
  public ApiResponse<Employee> create(@Valid @RequestBody Employee employee) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".create");
    employee.setId(null);
    return ApiResponse.ok(employeeService.createEmployee(employee));
  }

  @PutMapping("/{id}")
  public ApiResponse<Employee> update(@PathVariable Long id, @Valid @RequestBody Employee employee) {
    return ApiResponse.ok(employeeService.updateEmployee(id, employee));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    permissionGuard.requirePermission(PERMISSION_PREFIX + ".delete");
    return ApiResponse.ok(employeeService.deleteEmployee(id));
  }
}
