package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.Identifiable;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import java.math.BigDecimal;
import java.time.LocalDateTime;

@TableName("inventory_movements")
public class InventoryMovement implements Identifiable {
  @TableId(type = IdType.AUTO)
  private Long id;

  @NotBlank
  private String inventoryType;

  @NotNull
  private Long inventoryId;

  @NotBlank
  private String movementType;

  private BigDecimal quantity;
  private BigDecimal beforeQuantity;
  private BigDecimal afterQuantity;
  private String reason;
  private Long operatorId;
  private String remark;
  private LocalDateTime createdAt;

  public Long getId() {
    return id;
  }

  @Override
  public void setId(Long id) {
    this.id = id;
  }

  public String getInventoryType() {
    return inventoryType;
  }

  public void setInventoryType(String inventoryType) {
    this.inventoryType = inventoryType;
  }

  public Long getInventoryId() {
    return inventoryId;
  }

  public void setInventoryId(Long inventoryId) {
    this.inventoryId = inventoryId;
  }

  public String getMovementType() {
    return movementType;
  }

  public void setMovementType(String movementType) {
    this.movementType = movementType;
  }

  public BigDecimal getQuantity() {
    return quantity;
  }

  public void setQuantity(BigDecimal quantity) {
    this.quantity = quantity;
  }

  public BigDecimal getBeforeQuantity() {
    return beforeQuantity;
  }

  public void setBeforeQuantity(BigDecimal beforeQuantity) {
    this.beforeQuantity = beforeQuantity;
  }

  public BigDecimal getAfterQuantity() {
    return afterQuantity;
  }

  public void setAfterQuantity(BigDecimal afterQuantity) {
    this.afterQuantity = afterQuantity;
  }

  public String getReason() {
    return reason;
  }

  public void setReason(String reason) {
    this.reason = reason;
  }

  public Long getOperatorId() {
    return operatorId;
  }

  public void setOperatorId(Long operatorId) {
    this.operatorId = operatorId;
  }

  public String getRemark() {
    return remark;
  }

  public void setRemark(String remark) {
    this.remark = remark;
  }

  public LocalDateTime getCreatedAt() {
    return createdAt;
  }

  public void setCreatedAt(LocalDateTime createdAt) {
    this.createdAt = createdAt;
  }
}
