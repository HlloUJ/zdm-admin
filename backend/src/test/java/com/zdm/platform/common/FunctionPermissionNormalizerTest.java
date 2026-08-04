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

  @Test
  void expandsLegacyAttributePagePermissionsAcrossAllTabs() {
    assertThat(FunctionPermissionNormalizer.normalize(List.of(
        "admin.product-data-center.attribute.view",
        "admin.product-data-center.attribute.create",
        "admin.product-data-center.attribute.edit",
        "admin.product-data-center.attribute.delete")))
        .containsExactly(
            "admin.product-data-center.attribute.shared.view",
            "admin.product-data-center.attribute.finished.view",
            "admin.product-data-center.attribute.accessory.view",
            "admin.product-data-center.attribute.shared.create",
            "admin.product-data-center.attribute.finished.create",
            "admin.product-data-center.attribute.accessory.create",
            "admin.product-data-center.attribute.shared.toggle-status",
            "admin.product-data-center.attribute.finished.toggle-status",
            "admin.product-data-center.attribute.accessory.toggle-status",
            "admin.product-data-center.attribute.shared.delete",
            "admin.product-data-center.attribute.finished.delete",
            "admin.product-data-center.attribute.accessory.delete");
  }
}
