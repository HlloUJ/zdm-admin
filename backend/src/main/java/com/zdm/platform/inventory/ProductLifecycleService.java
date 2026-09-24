package com.zdm.platform.inventory;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.DataScope;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.SimpleJdbcInsert;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Coordinates source availability and the independent operations record in one transaction. */
@Service
public class ProductLifecycleService {
  public enum Kind {
    FINISHED("finished_products", "finished_product_prices", "finished_product_id", "finished_operation_logs", "product_id", "product_name", "merchant_code", "sku", "finished"),
    SLAB("slab_inventory", "slab_prices", "slab_id", "slab_operation_logs", "slab_id", "slab_name", "slab_serial_no", "serial_no", "slab");
    final String table, prices, priceKey, logs, logKey, logName, logCode, code, config;
    Kind(String table, String prices, String priceKey, String logs, String logKey, String logName, String logCode, String code, String config) {
      this.table=table; this.prices=prices; this.priceKey=priceKey; this.logs=logs;
      this.logKey=logKey; this.logName=logName; this.logCode=logCode; this.code=code; this.config=config;
    }
  }
  private final FinishedProductArrivalLogService arrivalLogs;
  private final SlabOperationLogService slabLogs;
  private final StoreFinishedUpstreamLogService storeUpstreamLogs;
  private final JdbcTemplate jdbc;
  private final CurrentIdentityProvider identities;
  private final ObjectMapper json;
  private final org.mybatis.spring.SqlSessionTemplate sqlSession;
  public ProductLifecycleService(JdbcTemplate jdbc, CurrentIdentityProvider identities, ObjectMapper json, org.mybatis.spring.SqlSessionTemplate sqlSession, FinishedProductArrivalLogService arrivalLogs, SlabOperationLogService slabLogs, StoreFinishedUpstreamLogService storeUpstreamLogs) {
    this.slabLogs=slabLogs;
    this.arrivalLogs=arrivalLogs;
    this.storeUpstreamLogs=storeUpstreamLogs;
    this.sqlSession=sqlSession;
    this.jdbc=jdbc; this.identities=identities; this.json=json;
  }
  public boolean isSupplyChain() { return "supply-chain".equals(identities.require().clientCode()); }
  public String prefix(String module) { return (isSupplyChain() ? "supply-chain." : "admin.") + module; }
  public void requireSupplyChain() {
    if (!isSupplyChain()) { throw new AccessDeniedException("来源商品只能由供应链维护"); }
  }
  public static boolean unavailable(String status) { return !"selling".equals(status) && !"soldOut".equals(status); }
  public static String sourceBlockMessage(String status, String retainedReason) {
    if (!unavailable(status)) { return null; }
    String reason = switch (status) {
      case "offShelf" -> "OFF_SHELF";
      case "recycle" -> "DELETE_TO_RECYCLE";
      case "purged" -> "PURGE";
      default -> retainedReason;
    };
    return switch (reason == null ? "" : reason) {
      case "OFF_SHELF" -> "该商品已被供应链下架";
      case "DELETE_TO_RECYCLE" -> "该商品已被供应链删除至回收站";
      case "PURGE" -> "该商品已被供应链彻底删除";
      default -> "上游商品不可用";
    };
  }
  public void requireOperational(String source, Boolean deleted) {
    if (Boolean.TRUE.equals(deleted)) { throw new IllegalArgumentException("运营商品已被彻底删除"); }
    if (unavailable(source)) { throw new IllegalArgumentException("来源商品未上架或已删除，只能彻底删除运营商品"); }
  }
  public Map<String,Object> lock(Kind kind, Long id) {
    var rows=jdbc.queryForList("SELECT * FROM "+kind.table+" WHERE id=? FOR UPDATE", id);
    if (rows.isEmpty()) { throw new IllegalArgumentException("商品不存在或已被彻底删除"); }
    var row=rows.getFirst();
    DataScope.requireAccess(identities.require(), row.get("created_by_account_id") instanceof Number n ? n.longValue() : null);
    return row;
  }
  private boolean deleted(Map<String,Object> row) {
    Object value=row.get("operations_deleted");
    return Boolean.TRUE.equals(value) || value instanceof Number n && n.intValue()!=0;
  }
  @Transactional
  public void checkSourceTransition(Kind kind, Long id, String target) {
    requireSupplyChain();
    var row = lock(kind, id);
    validateSourceTransition(kind, id, row, target);
  }

  private void validateSourceTransition(Kind kind, Long id, Map<String,Object> row, String target) {
    String source = (String) row.get("source_status");
    boolean allowed = switch (source) {
      case "warehouse" -> List.of("selling", "recycle").contains(target);
      case "selling" -> "offShelf".equals(target);
      case "offShelf" -> List.of("warehouse", "recycle").contains(target);
      case "recycle" -> List.of("warehouse", "purged").contains(target);
      default -> false;
    };
    if (!allowed) { throw new IllegalArgumentException("当前供应链状态不允许此操作"); }
    if ("selling".equals(target)) { validateSourceReady(kind, id, row); }
  }

  @Transactional
  public boolean sourceTransition(Kind kind, Long id, String target) {
    return sourceTransition(kind,id,target,null,null);
  }
  @Transactional
  public boolean sourceTransition(Kind kind, Long id, String target, String reason, String detail) {
    requireSupplyChain();
    var row=lock(kind,id);
    String source=(String)row.get("source_status");
    validateSourceTransition(kind, id, row, target);
    if("offShelf".equals(target) && (reason==null || reason.isBlank())) { throw new IllegalArgumentException("请选择下架原因"); }
    if(reason!=null && reason.length()>80 || detail!=null && detail.length()>500) { throw new IllegalArgumentException("下架说明超出长度限制"); }
    boolean publish="selling".equals(target);
    boolean recreate=publish && deleted(row);
    String blockReason = switch (target) {
      case "offShelf" -> "OFF_SHELF";
      case "recycle" -> "DELETE_TO_RECYCLE";
      case "purged" -> "PURGE";
      default -> null;
    };
    if ("warehouse".equals(target)) {
      jdbc.update("UPDATE "+kind.table+" SET source_status=? WHERE id=?",target,id);
    } else {
      jdbc.update("UPDATE "+kind.table+" SET source_status=?,source_block_reason=? WHERE id=?",target,blockReason,id);
    }
    if("offShelf".equals(target)) {
      if(kind==Kind.FINISHED) { jdbc.update("UPDATE finished_products SET source_off_shelf_reason=?,source_off_shelf_detail=?,source_off_shelf_at=NOW() WHERE id=?",reason,detail,id); }
      else { jdbc.update("INSERT INTO slab_off_shelf_records (slab_id,business_client_code,standard_reason,detail_reason,off_shelved_at,off_shelved_by_name,off_shelved_by_account_id) VALUES (?,'supply-chain',?,?,NOW(),?,?)",id,reason,detail,identities.require().displayName(),identities.require().accountId()); }
    }
    if(recreate) {
      jdbc.update("UPDATE "+kind.table+" SET operations_deleted=FALSE,status='warehouse' WHERE id=?",id);
      if(kind==Kind.FINISHED) { jdbc.update("UPDATE finished_products SET off_shelf_reason=NULL,off_shelf_detail=NULL,off_shelf_at=NULL WHERE id=?",id); }
      else { jdbc.update("DELETE FROM slab_off_shelf_records WHERE slab_id=? AND business_client_code='admin'",id); }
      reprice(kind,id,false);
    }
    String type=switch(target) { case "selling" -> "SHELF"; case "offShelf" -> "OFF_SHELF"; case "warehouse" -> kind == Kind.FINISHED ? "RESTORE" : "RESTORE_WAREHOUSE"; case "purged" -> "PURGE"; default -> "DELETE_TO_RECYCLE"; };
    String label=kind==Kind.FINISHED ? switch(target) { case "selling" -> "上架商品"; case "offShelf" -> "下架商品"; case "warehouse" -> "放回仓库"; case "purged" -> "彻底删除商品"; default -> "删除至回收站"; } : null;
    Map<String,Object> sourceChanges=new LinkedHashMap<>();
    if(reason!=null) { sourceChanges.put("下架原因",Map.of("before","","after",reason)); }
    if(detail!=null) { sourceChanges.put("详细说明",Map.of("before","","after",detail)); }
    record(kind,row,"supply-chain",type,label,source,target,sourceChanges);
    if (kind == Kind.FINISHED) { storeUpstreamLogs.sourceChange(id, source, target); }
    if (kind == Kind.FINISHED && recreate) {
      // Keep old store listings, manual prices and logs as history. The next store selection
      // receives a new listing ID and its own prices after operations shelves the product.
      jdbc.update("UPDATE finished_products SET selection_generation=selection_generation+1 WHERE id=?", id);
    }
    if ((!deleted(row) || recreate) && (kind != Kind.FINISHED || List.of("selling", "offShelf", "recycle", "purged").contains(target))) {
      String result=kind!=Kind.FINISHED ? null : publish ? (recreate ? "来源已上架，商品进入运营仓库并计算价格" : "来源重新上架，解除遮罩并保留运营状态") :
          "warehouse".equals(target) ? "来源放回仓库，等待再次上架" : "来源已下架或删除，运营商品仅可彻底删除";
      Map<String,Object> changes=new LinkedHashMap<>();
      changes.put("来源状态",Map.of("before",source,"after",target));
      if(recreate && kind == Kind.SLAB) { changes.putAll(slabLogs.arrivalSnapshot(id)); }
      if (kind == Kind.SLAB && !List.of("offShelf", "purged").contains(target)) {
        changes.putAll(sourceChanges);
      }
      String operationsType = switch (target) {
        case "selling" -> "SOURCE_SHELF";
        case "offShelf" -> "SOURCE_OFF_SHELF";
        case "recycle" -> "SOURCE_DELETE_TO_RECYCLE";
        case "purged" -> "SOURCE_PURGE";
        default -> "SOURCE_INTERNAL";
      };
      if (kind == Kind.FINISHED) {
        operationsType = switch (target) {
          case "selling" -> "SOURCE_SHELF";
          case "offShelf" -> "SOURCE_OFF_SHELF";
          case "recycle" -> "SOURCE_DELETE_TO_RECYCLE";
          default -> "SOURCE_PURGE";
        };
        if ("offShelf".equals(target)) { result = "供应链已下架该商品"; }
        if ("recycle".equals(target)) { result = "供应链已将该商品删除至回收站"; }
        if ("purged".equals(target)) { result = "供应链已彻底删除该商品"; }
      }
      if (kind == Kind.FINISHED && recreate) {
        sqlSession.clearCache();
        arrivalLogs.record(id, source);
      } else {
        record(kind,row,"admin",operationsType,result,recreate && kind == Kind.SLAB ? null : (String)row.get("status"),recreate?"warehouse":(String)row.get("status"),changes);
      }
    }
    sqlSession.clearCache();
    return "purged".equals(target) && deleted(row);
  }

  private void validateSourceReady(Kind kind,Long id,Map<String,Object> row) {
    if(!(row.get(kind==Kind.SLAB?"stock":"total_stock") instanceof Number stock) || stock.intValue()<=0) { throw new IllegalArgumentException("请完善库存后再上架"); }
    List<String> required=kind==Kind.SLAB ? List.of("supplier_id","variety_id","origin_id","texture_id","color_id","grade_id","length_mm","width_mm","thickness_mm","main_image_media_id","scan_image_media_id","design_image_media_id") : List.of("supplier_id","category_id","name","detail","main_image_media_id","video_media_id");
    if(required.stream().anyMatch(key -> row.get(key)==null || row.get(key).toString().isBlank())) { throw new IllegalArgumentException("请完善商品信息后再上架"); }
    var variants=kind==Kind.SLAB?List.of(row):jdbc.queryForList("SELECT cost_price FROM finished_product_variants WHERE finished_product_id=?",id);
    if(variants.isEmpty() || variants.stream().anyMatch(v -> !(v.get("cost_price") instanceof BigDecimal cost) || cost.signum()<0)) { throw new IllegalArgumentException("请完善成本价后再上架"); }
  }
  @Transactional
  public boolean purgeOperations(Kind kind, Long id) {
    if (isSupplyChain()) { throw new AccessDeniedException("此操作属于运营管理平台"); }
    var row=lock(kind,id);
    if (deleted(row)) { throw new IllegalArgumentException("运营商品已被彻底删除"); }
    if (!"recycle".equals(row.get("status")) && !unavailable((String)row.get("source_status"))) {
      throw new IllegalArgumentException("只有回收站或来源已删除的商品可以彻底删除");
    }
    record(kind,row,"admin","PURGE",kind==Kind.FINISHED ? "彻底删除运营商品" : null,(String)row.get("status"),"purged",Map.of());
    if (kind == Kind.FINISHED) {
      storeUpstreamLogs.operationsChange(id, "PURGE", (String) row.get("status"), "purged");
    }
    jdbc.update("UPDATE "+kind.table+" SET operations_deleted=TRUE,guide_price=NULL WHERE id=?",id);
    jdbc.update("DELETE FROM "+kind.prices+" WHERE "+kind.priceKey+"=?",id);
    if (kind==Kind.FINISHED) { jdbc.update("DELETE FROM finished_product_guide_prices WHERE finished_product_id=?",id); }
    else { jdbc.update("UPDATE slab_inventory SET guide_price_coefficient=NULL WHERE id=?",id); }
    sqlSession.clearCache();
    return "purged".equals(row.get("source_status"));
  }

  private List<Map<String,Object>> priceSnapshot(Kind kind,Long id) {
    var result=new ArrayList<>(jdbc.queryForList("SELECT * FROM "+kind.prices+" WHERE "+kind.priceKey+"=? ORDER BY id",id));
    if(kind==Kind.FINISHED) { result.addAll(jdbc.queryForList("SELECT * FROM finished_product_guide_prices WHERE finished_product_id=? ORDER BY id",id)); }
    else { result.addAll(jdbc.queryForList("SELECT cost_price,guide_price,guide_price_coefficient FROM slab_inventory WHERE id=?",id)); }
    return result;
  }
  /** Recompute with current configured coefficients, including prices previously set manually. */
  @Transactional
  public void reprice(Kind kind, Long id, boolean logImpact) {
    var row=lock(kind,id);
    if(deleted(row)) { return; }
    var before=priceSnapshot(kind,id);
    var guideRows=jdbc.queryForList("SELECT price_coefficient FROM "+kind.config+"_guide_price_settings WHERE id=1");
    if(guideRows.isEmpty()) { throw new IllegalArgumentException("请先在运营管理平台配置指导价系数"); }
    BigDecimal guide=(BigDecimal)guideRows.getFirst().get("price_coefficient");
    var levels=jdbc.queryForList("SELECT l.id,l.name,c.id AS configuration_id,c.price_coefficient,c.status AS configuration_status FROM store_levels l LEFT JOIN "+kind.config+"_markup_configurations c ON c.store_level_id=l.id WHERE l.status='enabled' ORDER BY l.id");
    var variants=kind==Kind.FINISHED ? jdbc.queryForList("SELECT id AS sku_id,variant_label,cost_price FROM finished_product_variants WHERE finished_product_id=? ORDER BY id",id):List.of(row);
    if(variants.isEmpty()) { throw new IllegalArgumentException("请完善商品规格与成本价"); }
    jdbc.update("DELETE FROM "+kind.prices+" WHERE "+kind.priceKey+"=? AND store_level_id IN (SELECT id FROM store_levels WHERE status='enabled')",id);
    if(kind==Kind.FINISHED) { jdbc.update("DELETE FROM finished_product_guide_prices WHERE finished_product_id=?",id); }
    for(var variant:variants) {
      BigDecimal cost=(BigDecimal)variant.get("cost_price");
      if(cost==null || cost.signum()<0) { throw new IllegalArgumentException("请完善商品成本价"); }
      if(kind==Kind.FINISHED) {
        jdbc.update("INSERT INTO finished_product_guide_prices (finished_product_id,sku_id,variant_label,price_coefficient,cost_price,price) VALUES (?,?,?,?,?,?)",id,variant.get("sku_id"),variant.get("variant_label"),guide,cost,amount(cost,guide));
      }
      for(var level:levels) {
        boolean configured = level.get("price_coefficient") != null && "enabled".equals(level.get("configuration_status"));
        var previous = before.stream()
            .filter(value -> java.util.Objects.equals(value.get("store_level_id"), level.get("id")))
            .filter(value -> kind != Kind.FINISHED || java.util.Objects.equals(value.get("sku_id"), variant.get("sku_id")))
            .findFirst().orElse(Map.of());
        BigDecimal coefficient = (BigDecimal)(configured ? level.get("price_coefficient") : previous.get("price_coefficient"));
        // Missing configuration leaves this tier for manual entry in operations.
        if (coefficient == null) { continue; }
        var price=new LinkedHashMap<String,Object>();
        price.put(kind.priceKey,id); price.put("store_level_id",level.get("id")); price.put("store_level_name",level.get("name"));
        price.put("price_coefficient",coefficient); price.put("cost_price",cost);
        price.put("price",amount(cost,coefficient));
        price.put("price_source",configured ? "auto" : "manual"); price.put("source_configuration_id",configured ? level.get("configuration_id") : null);
        if(kind==Kind.FINISHED) { price.put("store_level_name",level.get("name")); price.put("sku_id",variant.get("sku_id")); price.put("variant_label",variant.get("variant_label")); }
        new SimpleJdbcInsert(jdbc).withTableName(kind.prices).usingColumns(price.keySet().toArray(String[]::new)).execute(price);
      }
    }
    BigDecimal cost=(BigDecimal)variants.getFirst().get("cost_price");
    jdbc.update("UPDATE "+kind.table+" SET guide_price=?"+(kind==Kind.SLAB?",guide_price_coefficient=?":"")+" WHERE id=?",kind==Kind.SLAB?new Object[]{amount(cost,guide),guide,id}:new Object[]{amount(cost,guide),id});
    sqlSession.clearCache();
    if(logImpact) { record(kind,row,"admin","PRICE_UPDATE",kind==Kind.FINISHED ? "供应链成本变更，按当前系数重算售价" : null,(String)row.get("status"),(String)row.get("status"),Map.of("价格联动",Map.of("before",before,"after",priceSnapshot(kind,id)))); }
  }
  private BigDecimal amount(BigDecimal cost,BigDecimal coefficient) { return cost.multiply(coefficient).setScale(2,RoundingMode.HALF_UP); }
  private void record(Kind kind,Map<String,Object> row,String business,String type,String summary,String before,String after,Map<String,?> changes) {
    var actor=identities.require(); var log=new LinkedHashMap<String,Object>();
    log.put(kind.logKey,row.get("id")); log.put(kind.logName,row.get("name")); log.put(kind.logCode,row.get(kind.code)==null?"":row.get(kind.code));
    log.put("publisher_type",row.get("publisher_type")); log.put("product_created_by_account_id",row.get("created_by_account_id"));
    log.put("business_client_code",business);log.put("operator_client_code",actor.clientCode());log.put("operator_identity_id",actor.identityId());
    log.put("operator_name",actor.displayName());log.put("operator_account_id",actor.accountId());
    for (var entry : Map.of("下架原因","standard_reason","详细说明","detail_reason").entrySet()) {
      if (changes.get(entry.getKey()) instanceof Map<?,?> change) { log.put(entry.getValue(),change.get("after")); }
    }
    log.put("operation_type",type);
    log.put("operation_summary",kind==Kind.FINISHED ? summary : SlabOperationLogService.operationSummary(type, before, changes));
    log.put("before_status",before);log.put("after_status",after);
    log.put("operation_source",business.equals(actor.clientCode())?"MANUAL":"SUPPLY_CHAIN");log.put("operated_at",java.time.LocalDateTime.now());
    try { log.put("change_details",json.writeValueAsString(changes)); } catch(JsonProcessingException error) { throw new IllegalStateException("日志序列化失败",error); }
    Number logId = new SimpleJdbcInsert(jdbc).withTableName(kind.logs).usingColumns(log.keySet().toArray(String[]::new)).usingGeneratedKeyColumns("id").executeAndReturnKey(log);
    if(kind==Kind.SLAB) { slabLogs.retainSnapshot(logId.longValue(), changes); }
  }
}
