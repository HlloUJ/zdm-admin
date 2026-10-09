package com.zdm.platform.inventory;

import java.util.Arrays;
import java.util.stream.Collectors;

/** Shared display wording for downstream finished-product availability, including old records. */
public final class FinishedSourceMessage {
  private FinishedSourceMessage() {}

  public static String normalize(String value) {
    if (value == null) { return null; }
    return Arrays.stream(value.split("；")).map(FinishedSourceMessage::normalizeReason)
        .distinct().collect(Collectors.joining("；"));
  }

  private static String normalizeReason(String value) {
    String reason = value.replaceAll("，请彻底删除后重新(?:选择|获取)", "");
    String actor = reason.contains("供应链") ? "供应链"
        : reason.contains("运营端") || reason.contains("运营管理平台") ? "运营管理平台" : null;
    if (actor == null) { return reason; }
    String action = reason.contains("彻底删除") ? "彻底删除"
        : reason.contains("回收站") ? "删除至回收站" : reason.contains("下架") ? "下架" : null;
    return action == null ? reason : "该商品已被" + actor + action;
  }
}
