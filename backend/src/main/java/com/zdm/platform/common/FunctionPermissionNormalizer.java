package com.zdm.platform.common;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.springframework.util.StringUtils;

public final class FunctionPermissionNormalizer {
  private static final String ALL_PERMISSION = "all";
  private static final Set<String> RETIRED_STORE_PRICE_PERMISSIONS = Set.of(
      "store.price-configuration.view", "store.price-configuration.create",
      "store.price-configuration.edit", "store.price-configuration.toggle-status",
      "store.price-configuration.delete");
  private static final Set<String> RETIRED_CUSTOMER_ASSIGN = Set.of(
      "store.customer-management.daily.assign", "store.customer-management.archived.assign");
  private static final List<String> LEGACY_SCOPED_PERMISSION_PREFIXES = List.of(
      "admin.product-data-center.attribute.",
      "admin.product-data-center.attribute-value.");
  private static final List<String> ATTRIBUTE_SCOPES = List.of("shared", "finished", "accessory");
  private static final String LEGACY_STORE_PERMISSION_PREFIX = "admin.tenant.tenant-store-management";
  private static final String LEGACY_TENANT_PERMISSION_PREFIX = "admin.tenant.tenant-management";
  private static final List<String> CATEGORY_STATUS_PERMISSION_PREFIXES = List.of(
      "admin.tenant.store-category-management",
      "admin.product-data-center.category.finished",
      "admin.product-data-center.category.accessory");
  private static final Set<String> QUERY_SUFFIXES = Set.of("query", "查询");
  private static final Set<String> RESET_SUFFIXES = Set.of("reset", "重置");

  private FunctionPermissionNormalizer() {
  }

  public static String normalizeCsv(String permissionCsv) {
    if (!StringUtils.hasText(permissionCsv)) {
      return "";
    }
    return String.join(",", normalize(List.of(permissionCsv)));
  }

  public static List<String> normalize(Collection<String> permissionValues) {
    List<String> expandedValues = permissionValues.stream()
        .filter(StringUtils::hasText)
        .flatMap(value -> Stream.of(value.split(",")))
        .map(String::trim)
        .filter(StringUtils::hasText)
        .toList();
    if (expandedValues.contains(ALL_PERMISSION)) {
      return List.of(ALL_PERMISSION);
    }

    LinkedHashSet<String> normalizedValues = new LinkedHashSet<>();
    List<String> compatibleValues = expandedValues.stream()
        .flatMap(FunctionPermissionNormalizer::expandLegacyScopedPermission)
        .toList();
    for (String permission : compatibleValues) {
      if (RETIRED_CUSTOMER_ASSIGN.contains(permission) || RETIRED_STORE_PRICE_PERMISSIONS.contains(permission)) { continue; }
      String suffix = suffix(permission);
      if (RESET_SUFFIXES.contains(suffix)) {
        continue;
      }
      if (QUERY_SUFFIXES.contains(suffix)) {
        normalizedValues.add(viewPermission(permission));
        continue;
      }

      if (!"view".equals(suffix) && permission.contains(".") && !isProductGlobalAction(permission)) {
        normalizedValues.add(viewPermission(permission));
      }
      normalizedValues.add(permission);
    }
    return new ArrayList<>(normalizedValues);
  }

  public static boolean isProductGlobalAction(String permission) {
    return permission.matches("admin\\.(finished-stock-management|accessory-management|slab-management)\\.batch-shelf")
        || permission.matches("supply-chain\\.(finished-stock-management|accessory-management|slab-management)\\.publish")
        || permission.matches("store\\.(finished-stock-management|accessory-management)\\.select");
  }

  private static String suffix(String permission) {
    return permission.substring(permission.lastIndexOf('.') + 1);
  }

  private static Stream<String> expandLegacyScopedPermission(String permission) {
    var batch = java.util.regex.Pattern.compile("^(admin\\.(?:finished-stock-management|accessory-management|slab-management))\\.warehouse\\.batch-shelf$").matcher(permission);
    if (batch.matches()) { return Stream.of(permission, batch.group(1) + ".warehouse.view", batch.group(1) + ".batch-shelf"); }
    var product = java.util.regex.Pattern.compile(
        "^(supply-chain\\.(?:finished-stock-management|accessory-management|slab-management))\\.(warehouse|selling)\\.publish$|^(store\\.(?:finished-stock-management|accessory-management))\\.(warehouse)\\.select$")
        .matcher(permission);
    if (product.matches()) {
      String prefix = product.group(1) == null ? product.group(3) : product.group(1);
      String scope = product.group(2) == null ? product.group(4) : product.group(2);
      return Stream.of(prefix + "." + scope + ".view", prefix + (product.group(1) == null ? ".select" : ".publish"));
    }
    String categorySortPrefix = Stream.of("finished", "accessory")
        .map(scope -> "admin.product-data-center.category." + scope)
        .filter(prefix -> permission.equals(prefix + ".move-up") || permission.equals(prefix + ".move-down"))
        .findFirst().orElse(null);
    if (categorySortPrefix != null) {
      return Stream.of(categorySortPrefix + ".sort");
    }
    String legacyCategoryStatusPrefix = CATEGORY_STATUS_PERMISSION_PREFIXES.stream()
        .filter(prefix -> permission.equals(prefix + ".disable") || permission.equals(prefix + ".enable"))
        .findFirst()
        .orElse(null);
    if (legacyCategoryStatusPrefix != null) {
      return Stream.of(legacyCategoryStatusPrefix + ".toggle-status");
    }

    if (permission.startsWith(LEGACY_TENANT_PERMISSION_PREFIX + ".")) {
      String legacyAction = permission.substring(LEGACY_TENANT_PERMISSION_PREFIX.length() + 1);
      if ("view".equals(legacyAction)) {
        return Stream.of(
            LEGACY_TENANT_PERMISSION_PREFIX + ".unarchived.view",
            LEGACY_TENANT_PERMISSION_PREFIX + ".archived.view");
      }
      if (Set.of("create", "open-business", "edit").contains(legacyAction)) {
        return Stream.of(LEGACY_TENANT_PERMISSION_PREFIX + ".unarchived." + legacyAction);
      }
      if ("toggle-status".equals(legacyAction)) {
        return Stream.of(
            LEGACY_TENANT_PERMISSION_PREFIX + ".unarchived.archive",
            LEGACY_TENANT_PERMISSION_PREFIX + ".archived.restore");
      }
      if ("delete".equals(legacyAction)) {
        return Stream.of(LEGACY_TENANT_PERMISSION_PREFIX + ".archived.delete");
      }
    }

    if (permission.startsWith(LEGACY_STORE_PERMISSION_PREFIX + ".")) {
      String legacyAction = permission.substring(LEGACY_STORE_PERMISSION_PREFIX.length() + 1);
      if (Set.of("toggle-status", "operating.toggle-status").contains(legacyAction)) {
        return Stream.empty();
      }
      if ("view".equals(legacyAction)) {
        return Stream.of(
            LEGACY_STORE_PERMISSION_PREFIX + ".operating.view",
            LEGACY_STORE_PERMISSION_PREFIX + ".archived.view");
      }
      String operatingAction = switch (legacyAction) {
        case "create", "edit-level", "edit" -> legacyAction;
        case "delete" -> "archive";
        default -> null;
      };
      if (operatingAction != null) {
        return Stream.of(LEGACY_STORE_PERMISSION_PREFIX + ".operating." + operatingAction);
      }
    }

    String legacyPermissionPrefix = LEGACY_SCOPED_PERMISSION_PREFIXES.stream()
        .filter(permission::startsWith)
        .findFirst()
        .orElse(null);
    if (legacyPermissionPrefix == null) {
      return Stream.of(permission);
    }

    String legacyAction = permission.substring(legacyPermissionPrefix.length());
    String action = switch (legacyAction) {
      case "view", "query", "查询" -> "view";
      case "create" -> "create";
      case "edit", "toggle-status" -> "toggle-status";
      case "delete" -> "delete";
      default -> null;
    };
    if (action == null) {
      return Stream.of(permission);
    }
    return ATTRIBUTE_SCOPES.stream()
        .map(scope -> legacyPermissionPrefix + scope + "." + action);
  }

  private static String viewPermission(String permission) {
    int separatorIndex = permission.lastIndexOf('.');
    if (separatorIndex < 0) {
      return permission;
    }
    return permission.substring(0, separatorIndex) + ".view";
  }
}
