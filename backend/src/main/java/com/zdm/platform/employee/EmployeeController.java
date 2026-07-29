package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
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
  private final EmployeeService employeeService;

  public EmployeeController(EmployeeService employeeService) {
    this.employeeService = employeeService;
  }

  @GetMapping
  public ApiResponse<List<Employee>> list() {
    return ApiResponse.ok(employeeService.listForCurrentAdmin());
  }

  @PostMapping
  public ApiResponse<Employee> create(@Valid @RequestBody Employee employee) {
    employee.setId(null);
    return ApiResponse.ok(employeeService.createEmployee(employee));
  }

  @PutMapping("/{id}")
  public ApiResponse<Employee> update(@PathVariable Long id, @Valid @RequestBody Employee employee) {
    return ApiResponse.ok(employeeService.updateEmployee(id, employee));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(employeeService.deleteEmployee(id));
  }
}
