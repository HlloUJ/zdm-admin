package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

@TableName("slab_inventory")
public class SlabInventory extends BaseEntity {
  private Long supplierId;
  private Long varietyId;

  @NotBlank
  private String name;

  @NotBlank
  private String serialNo;

  private String warehouse;
  private String publisherType;
  private Integer lengthMm;
  private Integer widthMm;
  private Integer thicknessMm;
  private BigDecimal areaSquareMeter;
  private BigDecimal costPrice;
  private BigDecimal guidePrice;

  public Long getSupplierId() {
    return supplierId;
  }

  public void setSupplierId(Long supplierId) {
    this.supplierId = supplierId;
  }

  public Long getVarietyId() {
    return varietyId;
  }

  public void setVarietyId(Long varietyId) {
    this.varietyId = varietyId;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }

  public String getSerialNo() {
    return serialNo;
  }

  public void setSerialNo(String serialNo) {
    this.serialNo = serialNo;
  }

  public String getWarehouse() {
    return warehouse;
  }

  public void setWarehouse(String warehouse) {
    this.warehouse = warehouse;
  }

  public String getPublisherType() {
    return publisherType;
  }

  public void setPublisherType(String publisherType) {
    this.publisherType = publisherType;
  }

  public Integer getLengthMm() {
    return lengthMm;
  }

  public void setLengthMm(Integer lengthMm) {
    this.lengthMm = lengthMm;
  }

  public Integer getWidthMm() {
    return widthMm;
  }

  public void setWidthMm(Integer widthMm) {
    this.widthMm = widthMm;
  }

  public Integer getThicknessMm() {
    return thicknessMm;
  }

  public void setThicknessMm(Integer thicknessMm) {
    this.thicknessMm = thicknessMm;
  }

  public BigDecimal getAreaSquareMeter() {
    return areaSquareMeter;
  }

  public void setAreaSquareMeter(BigDecimal areaSquareMeter) {
    this.areaSquareMeter = areaSquareMeter;
  }

  public BigDecimal getCostPrice() {
    return costPrice;
  }

  public void setCostPrice(BigDecimal costPrice) {
    this.costPrice = costPrice;
  }

  public BigDecimal getGuidePrice() {
    return guidePrice;
  }

  public void setGuidePrice(BigDecimal guidePrice) {
    this.guidePrice = guidePrice;
  }
}
