package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductAttributeValueService
    extends ServiceImpl<ProductAttributeValueMapper, ProductAttributeValue> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;

  public ProductAttributeValueService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  @Transactional
  public ProductAttributeValue createValue(ProductAttributeValue value) {
    value.setId(null);
    value.setCreatedByName(resolveCreatedByName());
    save(value);
    return getById(value.getId());
  }

  @Transactional
  public ProductAttributeValue updateValue(Long id, ProductAttributeValue payload) {
    ProductAttributeValue existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("属性值不存在或已被删除");
    }
    existing.setAttributeId(payload.getAttributeId());
    existing.setScope(payload.getScope());
    existing.setValue(payload.getValue());
    existing.setCode(payload.getCode());
    existing.setStatus(payload.getStatus());
    updateById(existing);
    return getById(id);
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
