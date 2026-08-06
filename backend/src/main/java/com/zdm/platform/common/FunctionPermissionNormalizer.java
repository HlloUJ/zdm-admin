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
  private static final List<String> LEGACY_SCOPED_PERMISSION_PREFIXES = List.of(
      "admin.product-data-center.attribute.",
      "admin.product-data-center.attribute-value.");
  private static final List<String> ATTRIBUTE_SCOPES = List.of("shared", "finished", "accessory");
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
      String suffix = suffix(permission);
      if (RESET_SUFFIXES.contains(suffix)) {
        continue;
      }
      if (QUERY_SUFFIXES.contains(suffix)) {
        normalizedValues.add(viewPermission(permission));
        continue;
      }

      if (!"view".equals(suffix) && permission.contains(".")) {
        normalizedValues.add(viewPermission(permission));
      }
      normalizedValues.add(permission);
    }
    return new ArrayList<>(normalizedValues);
  }

  private static String suffix(String permission) {
    return permission.substring(permission.lastIndexOf('.') + 1);
  }

  private static Stream<String> expandLegacyScopedPermission(String permission) {
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
