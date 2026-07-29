package com.zdm.platform.role;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import org.springframework.stereotype.Service;

@Service
public class RoleService extends ServiceImpl<RoleMapper, Role> {
  private static final String SUPER_ADMIN_CODE = "SUPER_ADMIN";

  public boolean updateRole(Long id, Role payload) {
    Role existing = getById(id);
    if (existing == null) {
      return false;
    }

    payload.setId(id);
    if (isSuperAdminRole(existing)) {
      payload.setCode(SUPER_ADMIN_CODE);
      payload.setCategory(existing.getCategory());
      payload.setClientCode(existing.getClientCode());
      payload.setDataScope("all");
      payload.setStatus("enabled");
      payload.setFunctionPermissions("all");
    }
    return updateById(payload);
  }

  public boolean deleteRole(Long id) {
    Role existing = getById(id);
    if (existing == null) {
      return false;
    }
    if (isSuperAdminRole(existing)) {
      throw new IllegalArgumentException("超级管理员角色不可删除");
    }
    return removeById(id);
  }

  private boolean isSuperAdminRole(Role role) {
    return SUPER_ADMIN_CODE.equals(role.getCode());
  }
}
