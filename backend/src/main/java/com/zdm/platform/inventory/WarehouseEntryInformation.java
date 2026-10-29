package com.zdm.platform.inventory;

/** Current warehouse entry only. Historical reasons remain in immutable operation logs. */
public record WarehouseEntryInformation(String type, String reason, String detail) {
  public static WarehouseEntryInformation fromEvent(String before, String after, String operation, String reason, String detail) {
    if (!"warehouse".equals(after)) { return new WarehouseEntryInformation(null, null, null); }
    String type = switch (operation == null ? "" : operation) {
      case "OFF_SHELF" -> "offShelf";
      case "SOURCE_UPDATE" -> "selling".equals(before) ? "offShelf" : null;
      case "RESTORE", "RESTORE_WAREHOUSE", "RESTORE_RECYCLE" -> "recycle".equals(before) ? "recycleRestore" : null;
      case "CREATE", "SELECT", "SOURCE_SHELF" -> before == null ? "firstEntry" : null;
      case "REENTRY" -> "sourceReentry";
      case "UPDATE" -> "selling".equals(before) ? "editReturn" : null;
      default -> null;
    };
    return new WarehouseEntryInformation(type, "offShelf".equals(type) ? reason : null,
        "offShelf".equals(type) ? detail : null);
  }
  public static String changedText(Object value) {
    Object text = value instanceof java.util.Map<?, ?> change ? change.get("after") : value;
    return text == null ? null : text.toString();
  }
}
