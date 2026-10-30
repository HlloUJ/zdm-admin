package com.zdm.platform.inventory;

import com.zdm.platform.security.PermissionGuard;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

@Service
public class OperationsBatchShelfService {
  public record Failure(Long id, String code, String reason) {}
  public record Result(int total, int successCount, int failureCount, List<Failure> failures) {
    public Result { failures = List.copyOf(failures); }
  }
  private final PermissionGuard guard;
  private final ProductLifecycleService lifecycle;
  private final AccessoryLifecycleService accessoryLifecycle;
  private final FinishedProductService finished;
  private final AccessoryProductService accessory;
  private final SlabInventoryService slabs;
  private final TransactionTemplate transaction;

  public OperationsBatchShelfService(PermissionGuard guard, ProductLifecycleService lifecycle,
      AccessoryLifecycleService accessoryLifecycle, FinishedProductService finished,
      AccessoryProductService accessory, SlabInventoryService slabs, PlatformTransactionManager manager) {
    this.guard = guard; this.lifecycle = lifecycle; this.accessoryLifecycle = accessoryLifecycle;
    this.finished = finished; this.accessory = accessory; this.slabs = slabs;
    transaction = new TransactionTemplate(manager);
    transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
  }

  public Result shelf(String resource, List<Long> requested) {
    if (!"admin".equals(guard.identity().clientCode())) { throw new AccessDeniedException("此操作属于运营管理平台"); }
    String module = switch (resource) {
      case "finished-products" -> "finished-stock-management";
      case "accessory-products" -> "accessory-management";
      case "slabs" -> "slab-management";
      default -> throw new IllegalArgumentException("商品模块不正确");
    };
    String prefix = "admin." + module;
    guard.requirePermission(prefix + ".batch-shelf");
    guard.requireDataPermission();
    if (requested == null || requested.isEmpty() || requested.stream().anyMatch(id -> id == null || id <= 0)) {
      throw new IllegalArgumentException("请选择商品");
    }
    var ids = new LinkedHashSet<>(requested);
    var failures = new ArrayList<Failure>();
    for (Long id : ids) {
      try {
        transaction.executeWithoutResult(status -> shelfOne(resource, prefix, id));
      } catch (AccessDeniedException error) {
        failures.add(new Failure(id, "NOT_ACCESSIBLE", "商品不存在或无权操作"));
      } catch (IllegalArgumentException error) {
        String reason = error.getMessage();
        if ("商品不存在或已被彻底删除".equals(reason)) { failures.add(new Failure(id, "NOT_ACCESSIBLE", "商品不存在或无权操作")); }
        else { failures.add(new Failure(id, "VALIDATION_FAILED", reason == null || reason.isBlank() ? "商品不满足上架条件" : reason)); }
      } catch (RuntimeException error) {
        failures.add(new Failure(id, "EXECUTION_FAILED", "上架失败，请稍后重试"));
      }
    }
    return new Result(ids.size(), ids.size() - failures.size(), failures.size(), List.copyOf(failures));
  }

  private void shelfOne(String resource, String prefix, Long id) {
    switch (resource) {
      case "finished-products" -> {
        lifecycle.lock(ProductLifecycleService.Kind.FINISHED, id);
        FinishedProduct item = finished.getById(id);
        guard.requireData(item);
        requireStateView(prefix, item.getStatus());
        lifecycle.requireFinishedOperational(item);
        requireWarehouse(item.getStatus());
        FinishedProduct request = new FinishedProduct(); request.setStatus("selling");
        finished.updateOperationWithDetails(id, request, false);
      }
      case "accessory-products" -> {
        accessoryLifecycle.lock(AccessoryLifecycleService.Kind.ACCESSORY, id);
        AccessoryProduct item = accessory.getById(id);
        guard.requireData(item);
        requireStateView(prefix, item.getStatus());
        accessoryLifecycle.requireAccessoryOperational(item);
        requireWarehouse(item.getStatus());
        AccessoryProduct request = new AccessoryProduct(); request.setStatus("selling");
        accessory.updateOperationWithDetails(id, request, false);
      }
      case "slabs" -> {
        lifecycle.lock(ProductLifecycleService.Kind.SLAB, id);
        SlabInventory item = slabs.getById(id);
        guard.requireData(item);
        requireStateView(prefix, item.getStatus());
        lifecycle.requireSlabOperational(item);
        requireWarehouse(item.getStatus());
        slabs.updateStatuses(List.of(id), "selling", null, null);
      }
      default -> throw new IllegalArgumentException("商品模块不正确");
    }
  }
  private void requireStateView(String prefix, String state) {
    String scope = "soldOut".equals(state) ? "sold-out" : state;
    guard.requireAnyPermission(prefix + ".view", prefix + "." + scope + ".view");
  }
  private void requireWarehouse(String state) {
    if ("selling".equals(state)) { throw new IllegalArgumentException("已处于上架状态，不能重复上架"); }
    if (!"warehouse".equals(state)) { throw new IllegalArgumentException("商品当前不在仓库中，不能上架"); }
  }
}
