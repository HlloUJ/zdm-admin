package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductAttributeService extends ServiceImpl<ProductAttributeMapper, ProductAttribute> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;

  public ProductAttributeService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  public List<ProductAttribute> listWithTemplateCounts() {
    return baseMapper.selectWithTemplateCounts();
  }

  @Transactional
  public ProductAttribute createAttribute(ProductAttribute attribute) {
    attribute.setId(null);
    attribute.setCreatedByName(resolveCreatedByName());
    save(attribute);
    return getById(attribute.getId());
  }

  @Transactional
  public ProductAttribute updateStatus(Long id, String status) {
    ProductAttribute existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("属性不存在或已被删除");
    }
    existing.setStatus(status);
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
