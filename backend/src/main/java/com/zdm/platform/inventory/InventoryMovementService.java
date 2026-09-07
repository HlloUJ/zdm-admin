package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InventoryMovementService extends ServiceImpl<InventoryMovementMapper, InventoryMovement> {
  private final FinishedProductService finishedProductService;
  private final CurrentIdentityProvider identityProvider;

  public InventoryMovementService(
      FinishedProductService finishedProductService,
      CurrentIdentityProvider identityProvider) {
    this.finishedProductService = finishedProductService;
    this.identityProvider = identityProvider;
  }

  public List<InventoryMovement> listFinishedProductMovements(Long inventoryId) {
    if (inventoryId == null || finishedProductService.getById(inventoryId) == null) {
      throw new IllegalArgumentException("成品现货不存在或已被删除");
    }
    return lambdaQuery()
        .eq(InventoryMovement::getInventoryType, "finished_product")
        .eq(InventoryMovement::getInventoryId, inventoryId)
        .orderByDesc(InventoryMovement::getCreatedAt)
        .orderByDesc(InventoryMovement::getId)
        .list();
  }

  @Transactional
  public InventoryMovement createFinishedProductMovement(InventoryMovement movement) {
    if (!"finished_product".equals(movement.getInventoryType())
        || finishedProductService.getById(movement.getInventoryId()) == null) {
      throw new IllegalArgumentException("成品现货不存在或已被删除");
    }
    movement.setId(null);
    movement.setOperatorId(identityProvider.require().accountId());
    save(movement);
    return movement;
  }
}
