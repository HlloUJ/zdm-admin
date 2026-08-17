package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

@TableName("slab_colors")
public class SlabColor extends BaseEntity {
  @NotNull
  private Long categoryId;
  @NotBlank
  private String name;
  private String createdByName;
  private Long createdByAccountId;
  private String remark;
  @TableField(exist = false)
  private String categoryName;

  public Long getCategoryId() { return categoryId; }
  public void setCategoryId(Long categoryId) { this.categoryId = categoryId; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
  public String getCreatedByName() { return createdByName; }
  public void setCreatedByName(String createdByName) { this.createdByName = createdByName; }
  public Long getCreatedByAccountId() { return createdByAccountId; }
  public void setCreatedByAccountId(Long createdByAccountId) { this.createdByAccountId = createdByAccountId; }
  public String getRemark() { return remark; }
  public void setRemark(String remark) { this.remark = remark; }
  public String getCategoryName() { return categoryName; }
  public void setCategoryName(String categoryName) { this.categoryName = categoryName; }
}
