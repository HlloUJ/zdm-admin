package com.zdm.platform.inventory;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Enrich only records already admitted by the business service's identity and data scope. */
@Service
public class AccessoryStateActivityService {
 private final JdbcTemplate jdbc;
 public AccessoryStateActivityService(JdbcTemplate jdbc) { this.jdbc=jdbc; }
 public void record(String kind,String business,Long id,String before,String after,Long account,String source) {
  record(kind,business,id,before,after,account,source,null,null,null);
 }
 public void record(String kind,String business,Long id,String before,String after,Long account,String source,String operation,String reason,String detail) {
  if(after==null || java.util.Objects.equals(before,after)) { return; }
  var entry=WarehouseEntryInformation.fromEvent(before,after,operation,reason,detail);
  jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_account_id,operator_client_code,occurred_at,warehouse_entry_type,warehouse_entry_reason,warehouse_entry_detail) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6),?,?,?) ON DUPLICATE KEY UPDATE state=?,operator_account_id=?,operator_client_code=?,occurred_at=UTC_TIMESTAMP(6),warehouse_entry_type=?,warehouse_entry_reason=?,warehouse_entry_detail=?",kind,business,id,after,account,source,entry.type(),entry.reason(),entry.detail(),after,account,source,entry.type(),entry.reason(),entry.detail());
 }
 @org.springframework.transaction.annotation.Transactional
 public void storeStockChanged(Long productId,Integer before,Integer after) {
  if(before==null || after==null || (before==0)==(after==0)) { return; }
  String state=after==0?"soldOut":"selling";
  if (after==0) {
   jdbc.update("INSERT INTO store_accessory_operation_logs(tenant_id,store_id,listing_id,accessory_product_id,product_name,operation_type,operation_summary,before_status,after_status,change_details,operator_name) SELECT listing.tenant_id,listing.store_id,listing.id,listing.accessory_product_id,product.name,?,?,?, ?,JSON_OBJECT('状态',JSON_OBJECT('before',?,'after',?),'自动原因',?), '系统' FROM store_accessory_products listing JOIN accessory_products product ON product.id=listing.accessory_product_id WHERE listing.accessory_product_id=? AND listing.status='selling' AND listing.invalidated_at IS NULL","SOLD_OUT","统一库存已售完","selling",state,"selling",state,"统一库存耗尽",productId);
  }
  jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_client_code,occurred_at) SELECT 'store-accessory','store',id,?,'system',UTC_TIMESTAMP(6) FROM store_accessory_products WHERE accessory_product_id=? AND status='selling' AND invalidated_at IS NULL ON DUPLICATE KEY UPDATE state=?,operator_account_id=NULL,operator_client_code='system',occurred_at=UTC_TIMESTAMP(6),warehouse_entry_type=NULL,warehouse_entry_reason=NULL,warehouse_entry_detail=NULL",state,productId,state);
 }
 public <T extends StateActivityAware> List<T> attach(String kind,String business,List<T> records) {
  if(records.isEmpty()) { return records; }
  String placeholders=records.stream().map(item -> "?").collect(Collectors.joining(","));
  var args=new java.util.ArrayList<Object>(); args.add(kind); args.add(business);
  records.forEach(item -> args.add(item.getId()));
  Map<Long,Map<String,Object>> activity=jdbc.queryForList("SELECT a.*,CASE WHEN a.operator_account_id IS NOT NULL THEN COALESCE(account.display_name,'账号已不可用') WHEN a.operator_client_code='system' THEN '系统' WHEN a.operator_client_code='external-api' THEN '外部系统' ELSE NULL END AS operator_name FROM product_state_activity a LEFT JOIN accounts account ON account.id=a.operator_account_id WHERE a.kind=? AND a.business_client_code=? AND a.record_id IN ("+placeholders+")",args.toArray()).stream().collect(Collectors.toMap(row -> ((Number)row.get("record_id")).longValue(),row -> row));
  records.forEach(item -> {
   item.setWarehouseEntryType(null); item.setWarehouseEntryReason(null); item.setWarehouseEntryDetail(null);
   var row=activity.get(item.getId());
   String state="supply-chain".equals(business)?item.getSourceStatus():item.getStatus();
   if(row==null || !java.util.Objects.equals(state,row.get("state"))) { return; }
   item.setStateOperatedAt(StateActivityTime.read(row.get("occurred_at")));
   item.setStateOperatorName((String)row.get("operator_name"));
   if ("warehouse".equals(state)) {
    item.setWarehouseEntryType((String)row.get("warehouse_entry_type"));
    item.setWarehouseEntryReason((String)row.get("warehouse_entry_reason"));
    item.setWarehouseEntryDetail((String)row.get("warehouse_entry_detail"));
   }
  });
  return records;
 }
}
