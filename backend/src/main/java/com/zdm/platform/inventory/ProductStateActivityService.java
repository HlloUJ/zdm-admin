package com.zdm.platform.inventory;

import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/** Enrich only records already admitted by the business service's identity and data scope. */
@Service
public class ProductStateActivityService {
 private final JdbcTemplate jdbc;
 public ProductStateActivityService(JdbcTemplate jdbc) { this.jdbc=jdbc; }
 public void record(String kind,String business,Long id,String before,String after,Long account,String source) {
  if(after==null || java.util.Objects.equals(before,after)) { return; }
  jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_account_id,operator_client_code,occurred_at) VALUES(?,?,?,?,?,?,UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE state=?,operator_account_id=?,operator_client_code=?,occurred_at=UTC_TIMESTAMP(6)",kind,business,id,after,account,source,after,account,source);
 }
 @org.springframework.transaction.annotation.Transactional
 public void storeStockChanged(Long productId,Integer before,Integer after) {
  if(before==null || after==null || (before==0)==(after==0)) { return; }
  String state=after==0?"soldOut":"selling";
  jdbc.update("INSERT INTO store_finished_operation_logs(tenant_id,store_id,listing_id,finished_product_id,product_name,operation_type,operation_summary,before_status,after_status,change_details,operator_name) SELECT listing.tenant_id,listing.store_id,listing.id,listing.finished_product_id,product.name,?,?,?, ?,JSON_OBJECT('状态',JSON_OBJECT('before',?,'after',?),'自动原因',?), '系统' FROM store_finished_products listing JOIN finished_products product ON product.id=listing.finished_product_id WHERE listing.finished_product_id=? AND listing.status='selling' AND listing.invalidated_at IS NULL",after==0?"SOLD_OUT":"STATUS_UPDATE",after==0?"统一库存已售完":"统一库存恢复，商品恢复已上架",before==0?"soldOut":"selling",state,before==0?"soldOut":"selling",state,after==0?"统一库存耗尽":"统一库存恢复",productId);
  jdbc.update("INSERT INTO product_state_activity(kind,business_client_code,record_id,state,operator_client_code,occurred_at) SELECT 'store-finished','store',id,?,'system',UTC_TIMESTAMP(6) FROM store_finished_products WHERE finished_product_id=? AND status='selling' AND invalidated_at IS NULL ON DUPLICATE KEY UPDATE state=?,operator_account_id=NULL,operator_client_code='system',occurred_at=UTC_TIMESTAMP(6)",state,productId,state);
 }
 public <T extends StateActivityAware> List<T> attach(String kind,String business,List<T> records) {
  if(records.isEmpty()) { return records; }
  String placeholders=records.stream().map(item -> "?").collect(Collectors.joining(","));
  var args=new java.util.ArrayList<Object>(); args.add(kind); args.add(business);
  records.forEach(item -> args.add(item.getId()));
  Map<Long,Map<String,Object>> activity=jdbc.queryForList("SELECT a.*,CASE WHEN a.operator_account_id IS NOT NULL THEN COALESCE(account.display_name,'账号已不可用') WHEN a.operator_client_code='system' THEN '系统' WHEN a.operator_client_code='external-api' THEN '外部系统' ELSE NULL END AS operator_name FROM product_state_activity a LEFT JOIN accounts account ON account.id=a.operator_account_id WHERE a.kind=? AND a.business_client_code=? AND a.record_id IN ("+placeholders+")",args.toArray()).stream().collect(Collectors.toMap(row -> ((Number)row.get("record_id")).longValue(),row -> row));
  records.forEach(item -> {
   var row=activity.get(item.getId());
   String state="supply-chain".equals(business)?item.getSourceStatus():item.getStatus();
   if(row==null || !java.util.Objects.equals(state,row.get("state"))) { return; }
   item.setStateOperatedAt(StateActivityTime.read(row.get("occurred_at")));
   item.setStateOperatorName((String)row.get("operator_name"));
  });
  return records;
 }
}
