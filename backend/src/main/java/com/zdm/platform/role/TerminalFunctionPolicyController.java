package com.zdm.platform.role;

import com.zdm.platform.common.ApiResponse;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/admin/terminal-function-policies")
public class TerminalFunctionPolicyController {
  public record UpdateRequest(String functionPermissions) {}

  private final TerminalFunctionPolicyService service;

  public TerminalFunctionPolicyController(TerminalFunctionPolicyService service) {
    this.service = service;
  }

  @GetMapping
  public ApiResponse<List<TerminalFunctionPolicy>> list() {
    return ApiResponse.ok(service.listPolicies());
  }

  @PutMapping("/{terminal}")
  public ApiResponse<TerminalFunctionPolicy> save(
      @PathVariable String terminal,
      @RequestBody UpdateRequest request) {
    return ApiResponse.ok(service.savePolicy(terminal, request.functionPermissions()));
  }
}
