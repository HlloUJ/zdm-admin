package com.zdm.platform.employee;

import com.zdm.platform.common.ApiResponse;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/supply-chain-administrators")
public class SupplyChainAdminController {
  public record ProfileRequest(@NotBlank @Size(max=80) String name,
      @NotBlank @Pattern(regexp="male|female") String gender, @Size(max=100) String remark) {}
  public record StatusRequest(@NotBlank @Pattern(regexp="enabled|disabled") String status) {}
  private final SupplyChainAdminService administrators;

  public SupplyChainAdminController(SupplyChainAdminService administrators) {
    this.administrators = administrators;
  }

  @PutMapping("/{id}")
  public ApiResponse<Employee> update(@PathVariable Long id, @Valid @RequestBody ProfileRequest request) {
    return ApiResponse.ok(administrators.updateProfile(id, request));
  }

  @PatchMapping("/{id}/status")
  public ApiResponse<Employee> status(@PathVariable Long id, @Valid @RequestBody StatusRequest request) {
    return ApiResponse.ok(administrators.updateStatus(id, request.status()));
  }

  @DeleteMapping("/{id}")
  public ApiResponse<Boolean> delete(@PathVariable Long id) {
    return ApiResponse.ok(administrators.deleteAdministrator(id));
  }
}
