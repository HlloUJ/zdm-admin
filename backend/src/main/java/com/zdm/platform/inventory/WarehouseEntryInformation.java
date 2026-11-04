package com.zdm.platform.inventory;

/** Current warehouse entry only. Historical reasons remain in immutable operation logs. */
public record WarehouseEntryInformation(String type, String reason, String detail) {
  public static WarehouseEntryInformation fromEvent(String before, String after, String operation, String reason, String detail) {
    if (!"warehouse".equals(after)) { return new WarehouseEntryInformation(null, null, null); }
    String type = switch (operation == null ? "" : operation) {
      case "OFF_SHELF" -> "offShelf";
      case "SOURCE_UPDATE" -> "selling".equals(before) ? "offShelf" : null;
      case "RESTORE", "RESTORE_WAREHOUSE", "RESTORE_RECYCLE" -> "recycle".equals(before) ? "recycleRestore" : null;
      case "CREATE" -> before == null ? "createEntry" : null;
      case "SELECT" -> before == null ? "productCenterSelect" : null;
      case "SOURCE_SHELF", "REENTRY" -> before == null ? "sourceShelfEntry" : null;
      default -> null;
    };
    return new WarehouseEntryInformation(type, "offShelf".equals(type) ? reason : null,
        "offShelf".equals(type) ? detail : null);
  }
  /** Read old known origins without rewriting stored history or guessing absent provenance. */
  public static String currentType(String type, String business) {
    if ("firstEntry".equals(type)) {
      return switch (business == null ? "" : business) {
        case "supply-chain" -> "createEntry";
        case "admin" -> "sourceShelfEntry";
        case "store" -> "productCenterSelect";
        default -> type;
      };
    }
    return "sourceReentry".equals(type) && "admin".equals(business) ? "sourceShelfEntry" : type;
  }
  public static String changedText(Object value) {
    Object text = value instanceof java.util.Map<?, ?> change ? change.get("after") : value;
    return text == null ? null : text.toString();
  }
}
