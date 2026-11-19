package com.zdm.platform.storeexit;

import java.util.Map;

/** Shared by reference-write fences and exit cleanup; uploader scope is not used as ownership. */
public final class StoreExitMediaDomains {
  public static final Map<String, String> PARENTS = Map.of(
      "STORE_CUSTOMER_FOLLOWUP", "store_customer_followups",
      "STORE_FINISHED_INVALIDATION", "store_finished_products",
      "STORE_ACCESSORY_INVALIDATION", "store_accessory_products",
      "STORE_FINISHED_PRODUCT_LOG", "store_finished_operation_logs",
      "STORE_ACCESSORY_PRODUCT_LOG", "store_accessory_operation_logs");
  private StoreExitMediaDomains() { }
}
