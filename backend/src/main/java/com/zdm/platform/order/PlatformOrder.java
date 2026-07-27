package com.zdm.platform.order;

import com.baomidou.mybatisplus.annotation.TableName;
import com.zdm.platform.common.BaseEntity;
import jakarta.validation.constraints.NotBlank;
import java.math.BigDecimal;

@TableName("platform_orders")
public class PlatformOrder extends BaseEntity {
  @NotBlank
  private String orderNo;

  @NotBlank
  private String orderType;

  @NotBlank
  private String sourceClient;

  private Long tenantId;
  private Long storeId;
  private String customerName;
  private String customerPhone;
  private BigDecimal totalAmount;
  private BigDecimal paidAmount;
  private String remark;

  public String getOrderNo() {
    return orderNo;
  }

  public void setOrderNo(String orderNo) {
    this.orderNo = orderNo;
  }

  public String getOrderType() {
    return orderType;
  }

  public void setOrderType(String orderType) {
    this.orderType = orderType;
  }

  public String getSourceClient() {
    return sourceClient;
  }

  public void setSourceClient(String sourceClient) {
    this.sourceClient = sourceClient;
  }

  public Long getTenantId() {
    return tenantId;
  }

  public void setTenantId(Long tenantId) {
    this.tenantId = tenantId;
  }

  public Long getStoreId() {
    return storeId;
  }

  public void setStoreId(Long storeId) {
    this.storeId = storeId;
  }

  public String getCustomerName() {
    return customerName;
  }

  public void setCustomerName(String customerName) {
    this.customerName = customerName;
  }

  public String getCustomerPhone() {
    return customerPhone;
  }

  public void setCustomerPhone(String customerPhone) {
    this.customerPhone = customerPhone;
  }

  public BigDecimal getTotalAmount() {
    return totalAmount;
  }

  public void setTotalAmount(BigDecimal totalAmount) {
    this.totalAmount = totalAmount;
  }

  public BigDecimal getPaidAmount() {
    return paidAmount;
  }

  public void setPaidAmount(BigDecimal paidAmount) {
    this.paidAmount = paidAmount;
  }

  public String getRemark() {
    return remark;
  }

  public void setRemark(String remark) {
    this.remark = remark;
  }
}
