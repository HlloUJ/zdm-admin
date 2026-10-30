package com.zdm.platform.inventory;

import com.zdm.platform.security.PermissionGuard;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** Used only by All-tab batch shelving; existing warehouse flows are retained. */
@Service
public class ProductAllBatchShelfService {
  private final PermissionGuard guard;
  private final ProductLifecycleService lifecycle;
  private final AccessoryLifecycleService accessoryLifecycle;
  private final FinishedProductService finished;
  private final AccessoryProductService accessory;
  private final SlabInventoryService slabs;
  private final StoreFinishedProductService storeFinished;
  private final StoreAccessoryProductService storeAccessory;
  private final CityPartnerStoreScope scopes;
  private final JdbcTemplate jdbc;
  private final TransactionTemplate transaction;
  public ProductAllBatchShelfService(PermissionGuard guard, ProductLifecycleService lifecycle,
      AccessoryLifecycleService accessoryLifecycle, FinishedProductService finished,
      AccessoryProductService accessory, SlabInventoryService slabs,
      StoreFinishedProductService storeFinished, StoreAccessoryProductService storeAccessory,
      CityPartnerStoreScope scopes, JdbcTemplate jdbc, PlatformTransactionManager manager) {
    this.guard=guard; this.lifecycle=lifecycle; this.accessoryLifecycle=accessoryLifecycle;
    this.finished=finished; this.accessory=accessory; this.slabs=slabs;
    this.storeFinished=storeFinished; this.storeAccessory=storeAccessory; this.scopes=scopes; this.jdbc=jdbc;
    transaction=new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }
  public OperationsBatchShelfService.Result shelf(String resource, List<Long> requested) {
    boolean store=resource.startsWith("store-");
    String kind=switch(resource) {
      case "finished-products", "store-finished-products" -> "finished-stock-management";
      case "accessory-products", "store-accessory-products" -> "accessory-management";
      case "slabs" -> "slab-management";
      default -> throw new IllegalArgumentException("商品模块不正确");
    };
    if (store) { scopes.require(); }
    else if (!"supply-chain".equals(guard.identity().clientCode())) { throw new AccessDeniedException("此操作属于供应链协同系统"); }
    String prefix=(store?"store.":"supply-chain.")+kind;
    guard.requirePermission(prefix+".batch-shelf"); guard.requireDataPermission();
    if(requested==null || requested.isEmpty() || requested.stream().anyMatch(id -> id==null || id<=0)) { throw new IllegalArgumentException("请选择商品"); }
    var ids=new LinkedHashSet<>(requested);
    var failures=new ArrayList<OperationsBatchShelfService.Failure>();
    for(Long id:ids) {
      try {
        transaction.executeWithoutResult(status -> {
          if(store) { shelfStore(resource,prefix,id); }
          else { shelfSource(resource,prefix,id); }
        });
      } catch(AccessDeniedException error) {
        failures.add(new OperationsBatchShelfService.Failure(id,"NOT_ACCESSIBLE","商品不存在或无权操作"));
      } catch(IllegalArgumentException error) {
        String reason=error.getMessage();
        if(List.of("商品不存在或已被彻底删除","本门店商品不存在或不可访问").contains(reason==null?"":reason)) {
          failures.add(new OperationsBatchShelfService.Failure(id,"NOT_ACCESSIBLE","商品不存在或无权操作"));
        } else { failures.add(new OperationsBatchShelfService.Failure(id,"VALIDATION_FAILED",reason==null || reason.isBlank()?"商品不满足上架条件":reason)); }
      } catch(RuntimeException error) {
        failures.add(new OperationsBatchShelfService.Failure(id,"EXECUTION_FAILED","上架失败，请稍后重试"));
      }
    }
    return new OperationsBatchShelfService.Result(ids.size(),ids.size()-failures.size(),failures.size(),failures);
  }
  private void shelfSource(String resource,String prefix,Long id) {
    String state;
    switch(resource) {
      case "finished-products" -> {
        lifecycle.lock(ProductLifecycleService.Kind.FINISHED,id);
        FinishedProduct product=finished.getById(id); guard.requireData(product); state=product.getSourceStatus();
      }
      case "accessory-products" -> {
        accessoryLifecycle.lock(AccessoryLifecycleService.Kind.ACCESSORY,id);
        AccessoryProduct product=accessory.getById(id); guard.requireData(product); state=product.getSourceStatus();
      }
      case "slabs" -> {
        lifecycle.lock(ProductLifecycleService.Kind.SLAB,id);
        SlabInventory product=slabs.getById(id); guard.requireData(product); state=product.getSourceStatus();
      }
      default -> throw new IllegalArgumentException("商品模块不正确");
    }
    requireStateView(prefix,state); requireWarehouse(state);
    switch(resource) {
      case "finished-products" -> finished.sourceTransition(id,"selling",null,null);
      case "accessory-products" -> accessory.sourceTransition(id,"selling",null,null);
      case "slabs" -> slabs.updateStatuses(List.of(id),"selling",null,null);
      default -> throw new IllegalArgumentException("商品模块不正确");
    }
  }
  private void shelfStore(String resource,String prefix,Long id) {
    var store=scopes.require();
    boolean isAccessory="store-accessory-products".equals(resource);
    String kind=isAccessory?"accessory":"finished";
    // Match the original source-before-listing lock order and enforce tenant/store ownership first.
    var sourceIds=jdbc.queryForList("SELECT "+kind+"_product_id FROM store_"+kind+"_products WHERE id=? AND tenant_id=? AND store_id=?",Long.class,id,store.tenantId(),store.storeId());
    if(sourceIds.isEmpty()) { throw new AccessDeniedException("商品不存在或无权操作"); }
    var stocks=jdbc.queryForList("SELECT total_stock FROM "+kind+"_products WHERE id=? FOR UPDATE",Integer.class,sourceIds.getFirst());
    var states=jdbc.queryForList("SELECT status FROM store_"+kind+"_products WHERE id=? AND tenant_id=? AND store_id=? FOR UPDATE",String.class,id,store.tenantId(),store.storeId());
    if(states.isEmpty() || stocks.isEmpty()) { throw new AccessDeniedException("商品不存在或无权操作"); }
    String state=states.getFirst();
    if("selling".equals(state) && stocks.getFirst()!=null && stocks.getFirst()<=0) { state="soldOut"; }
    requireStateView(prefix,state); requireWarehouse(state);
    if(isAccessory) { storeAccessory.changeStatus(id,"selling",null,null); }
    else { storeFinished.changeStatus(id,"selling",null,null); }
  }
  private void requireStateView(String prefix,String state) {
    guard.requireAnyPermission(prefix+".view",prefix+"."+("soldOut".equals(state)?"sold-out":state)+".view");
  }
  private void requireWarehouse(String state) {
    if("selling".equals(state)) { throw new IllegalArgumentException("已处于上架状态，不能重复上架"); }
    if(!"warehouse".equals(state)) { throw new IllegalArgumentException("商品当前不在仓库中，不能上架"); }
  }
}
