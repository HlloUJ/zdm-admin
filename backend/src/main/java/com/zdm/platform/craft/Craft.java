package com.zdm.platform.craft;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

@TableName("crafts")
public class Craft extends BaseEntity {
  @NotBlank
  private String name;

  @NotBlank
  private String type;

  @Pattern(regexp = "\\d*", message = "工艺宽度仅支持数字")
  private String width;
  private String description;
  private String imageUrl;
  private String pricingMethod;
  private String createdByName;

  @Size(max = 100, message = "备注最多输入100个字符")
  private String remark;

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getType() {
    return type;
  }

  public void setType(String type) {
    this.type = type;
  }

  public String getWidth() {
    return width;
  }

  public void setWidth(String width) {
    this.width = width;
  }

  public String getDescription() {
    return description;
  }

  public void setDescription(String description) {
    this.description = description;
  }

  public String getImageUrl() {
    return imageUrl;
  }

  public void setImageUrl(String imageUrl) {
    this.imageUrl = imageUrl;
  }

  public String getPricingMethod() {
    return pricingMethod;
  }

  public void setPricingMethod(String pricingMethod) {
    this.pricingMethod = pricingMethod;
  }

  public String getCreatedByName() {
    return createdByName;
  }

  public void setCreatedByName(String createdByName) {
    this.createdByName = createdByName;
  }

  public String getRemark() {
    return remark;
  }

  public void setRemark(String remark) {
    this.remark = remark;
  }
}
