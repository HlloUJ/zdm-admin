package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Records one store-owned audit event per selected listing affected by an upstream change. */
@Service
public class StoreFinishedUpstreamLogService {
  private final JdbcTemplate jdbc;
  private final ObjectMapper json;
  private final CurrentIdentityProvider identities;

  public StoreFinishedUpstreamLogService(JdbcTemplate jdbc, ObjectMapper json,
      CurrentIdentityProvider identities) {
    this.jdbc = jdbc;
    this.json = json;
    this.identities = identities;
  }

  public void sourceChange(Long productId, String before, String after) {
    String type = switch (after) {
      case "offShelf" -> "SOURCE_OFF_SHELF";
      case "recycle" -> "SOURCE_DELETE_TO_RECYCLE";
      case "purged" -> "SOURCE_PURGE";
      case "selling" -> "SOURCE_SHELF";
      default -> null;
    };
    if (type == null) { return; }
    String summary = switch (type) {
      case "SOURCE_OFF_SHELF" -> "供应链已下架该商品";
      case "SOURCE_DELETE_TO_RECYCLE" -> "供应链已将该商品删除至回收站";
      case "SOURCE_PURGE" -> "供应链已彻底删除该商品";
      default -> "供应链已重新上架该商品";
    };
    record(productId, type, summary, "来源状态", before, after);
  }

  public void operationsChange(Long productId, String type, String before, String after) {
    String storeType = switch (type) {
      case "OFF_SHELF" -> "OPERATIONS_OFF_SHELF";
      case "DELETE_TO_RECYCLE" -> "OPERATIONS_DELETE_TO_RECYCLE";
      case "PURGE" -> "OPERATIONS_PURGE";
      case "SHELF" -> "OPERATIONS_SHELF";
      default -> null;
    };
    if (storeType == null) { return; }
    String summary = switch (storeType) {
      case "OPERATIONS_OFF_SHELF" -> "运营端已下架该商品";
      case "OPERATIONS_DELETE_TO_RECYCLE" -> "运营端已将该商品删除至回收站";
      case "OPERATIONS_PURGE" -> "运营端已彻底删除该商品";
      default -> "运营端已重新上架该商品";
    };
    record(productId, storeType, summary, "运营状态", before, after);
  }

  private void record(Long productId, String type, String summary, String field,
      String before, String after) {
    final String changes;
    try {
      changes = json.writeValueAsString(Map.of(field, Map.of("before", before, "after", after)));
    } catch (JsonProcessingException error) {
      throw new IllegalStateException("门店上游操作日志序列化失败", error);
    }
    var actor = identities.require();
    jdbc.update("""
        INSERT INTO store_finished_operation_logs
          (tenant_id, store_id, listing_id, finished_product_id, product_name,
           operation_type, operation_summary, before_status, after_status, change_details,
           operator_account_id, operator_name)
        SELECT listing.tenant_id, listing.store_id, listing.id, listing.finished_product_id,
          product.name, ?, ?, listing.status, listing.status, ?, ?, ?
        FROM store_finished_products listing
        JOIN finished_products product ON product.id = listing.finished_product_id
        WHERE listing.finished_product_id = ?
          AND listing.selection_generation = product.selection_generation
        """, type, summary, changes, actor.accountId(), actor.displayName(), productId);
  }
}
