package com.zdm.platform.craft;

import com.zdm.platform.security.PermissionGuard;
import org.springframework.stereotype.Component;

@Component
public class CraftPermissionGuard {
  public static final String PREFIX = "admin.product-data-center.finished-stock-craft";

  private final PermissionGuard permissionGuard;

  public CraftPermissionGuard(PermissionGuard permissionGuard) {
    this.permissionGuard = permissionGuard;
  }

  public void requireView() {
    permissionGuard.requireView(PREFIX);
  }

  public void requireCreate() {
    requireView();
    permissionGuard.requirePermission(PREFIX + ".create");
  }

  public void requireEdit() {
    requireView();
    permissionGuard.requirePermission(PREFIX + ".edit");
  }

  public void requireToggleStatus() {
    requireView();
    permissionGuard.requirePermission(PREFIX + ".toggle-status");
  }

  public void requireDelete() {
    requireView();
    permissionGuard.requirePermission(PREFIX + ".delete");
  }

  public void requireImageUpload() {
    requireView();
    permissionGuard.requireAnyPermission(PREFIX + ".create", PREFIX + ".edit");
  }
}
