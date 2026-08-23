package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.annotation.TableName;
import com.baomidou.mybatisplus.annotation.TableField;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;

@TableName("supplier_supply_types")
public class SupplierSupplyType extends BaseEntity {
  private String code;

  @NotBlank
  private String name;

  private String createdByName;
  private Long createdByAccountId;

  @TableField(exist = false)
  private boolean referenced;

  public String getCode() { return code; }
  public void setCode(String code) { this.code = code; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
  public String getCreatedByName() { return createdByName; }
  public void setCreatedByName(String createdByName) { this.createdByName = createdByName; }
  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long createdByAccountId) { this.createdByAccountId = createdByAccountId; }
  public boolean isReferenced() { return referenced; }
  public void setReferenced(boolean referenced) { this.referenced = referenced; }
}
