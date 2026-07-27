package com.zdm.admin.employee;

import com.zdm.admin.common.ApiResponse;
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
@RequestMapping("/api/employees")
public class EmployeeController {
  private final EmployeeService employeeService;

  public EmployeeController(EmployeeService employeeService) {
    this.employeeService = employeeService;
  }

  @GetMapping
  public ApiResponse<List<Employee>> list() {
    return ApiResponse.ok(employeeService.list());
  }

  @PostMapping
  public ApiResponse<Employee> create(@Valid @RequestBody Employee employee) {
    employee.setId(null);
    employeeService.save(employee);
    return ApiResponse.ok(employee);
  }

  @PutMapping("/{id}")
  public ApiResponse<Employee> update(@PathVariable Long id, @Valid @RequestBody Employee employee) {
    employee.setId(id);
    employeeService.updateById(employee);
    return ApiResponse.ok(employeeService.getById(id));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(employeeService.removeById(id));
  }
}
