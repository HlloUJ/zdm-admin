package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.PermissionGuard;
import com.zdm.platform.security.FunctionAudiencePolicy;
import org.springframework.security.access.AccessDeniedException;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class TerminalFunctionPolicyService
    extends ServiceImpl<TerminalFunctionPolicyMapper, TerminalFunctionPolicy> {
  private final PermissionGuard permissionGuard;

  public TerminalFunctionPolicyService(PermissionGuard permissionGuard) {
    this.permissionGuard = permissionGuard;
  }

  public List<TerminalFunctionPolicy> listPolicies() {
    permissionGuard.requirePermission("admin.permission-management.terminal-function-allocation.view");
    return lambdaQuery().orderByAsc(TerminalFunctionPolicy::getId).list().stream().peek(policy ->
        policy.setFunctionPermissions(String.join(",", FunctionAudiencePolicy.filter(
            FunctionPermissionNormalizer.normalize(List.of(policy.getFunctionPermissions() == null
                ? "" : policy.getFunctionPermissions())), policy.getTerminal())))).toList();
  }

  @Transactional
  public TerminalFunctionPolicy savePolicy(String terminal, String functionPermissions) {
    permissionGuard.requirePermission("admin.permission-management.terminal-function-allocation.save");
    if (!"store".equals(terminal) && !"supplier".equals(terminal)) {
      throw new IllegalArgumentException("未知的用户端类型");
    }
    List<String> selected = FunctionPermissionNormalizer.normalize(
        List.of(functionPermissions == null ? "" : functionPermissions));
    if (selected.stream().anyMatch(permission -> !FunctionAudiencePolicy.allows(permission, terminal))) {
      throw new AccessDeniedException("当前用户端不能分配这些功能权限");
    }
    TerminalFunctionPolicy policy = lambdaQuery()
        .eq(TerminalFunctionPolicy::getTerminal, terminal)
        .one();
    if (policy == null) {
      policy = new TerminalFunctionPolicy();
      policy.setTerminal(terminal);
    }
    policy.setFunctionPermissions(FunctionPermissionNormalizer.normalizeCsv(functionPermissions));
    saveOrUpdate(policy);
    return getById(policy.getId());
  }
}
