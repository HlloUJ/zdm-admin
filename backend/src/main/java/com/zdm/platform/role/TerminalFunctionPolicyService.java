package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.FunctionPermissionNormalizer;
import com.zdm.platform.security.PermissionGuard;
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
    permissionGuard.requireSuperAdmin();
    return lambdaQuery().orderByAsc(TerminalFunctionPolicy::getId).list();
  }

  @Transactional
  public TerminalFunctionPolicy savePolicy(String terminal, String functionPermissions) {
    permissionGuard.requireSuperAdmin();
    if (!"store".equals(terminal) && !"supplier".equals(terminal)) {
      throw new IllegalArgumentException("未知的用户端类型");
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
