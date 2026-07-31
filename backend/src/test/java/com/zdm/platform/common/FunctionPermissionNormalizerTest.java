package com.zdm.platform.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;

class FunctionPermissionNormalizerTest {
  @Test
  void replacesQueryAndDropsResetPermissions() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.query,"
            + "admin.permission-management.employee-management.reset")))
        .containsExactly("admin.permission-management.employee-management.view");
  }

  @Test
  void addsViewBeforeEveryMutatingOrSensitiveAction() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.edit",
        "admin.slab-management.warehouse.view-price")))
        .containsExactly(
            "admin.permission-management.employee-management.view",
            "admin.permission-management.employee-management.edit",
            "admin.slab-management.warehouse.view",
            "admin.slab-management.warehouse.view-price");
  }

  @Test
  void keepsAllAsTheOnlyPermission() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.permission-management.employee-management.edit",
        "all")))
        .containsExactly("all");
  }
}
