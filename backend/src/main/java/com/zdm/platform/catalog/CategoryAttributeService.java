package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CategoryAttributeService extends ServiceImpl<CategoryAttributeMapper, CategoryAttribute> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;

  public CategoryAttributeService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  @Transactional
  public CategoryAttribute createCategoryAttribute(CategoryAttribute categoryAttribute) {
    categoryAttribute.setId(null);
    categoryAttribute.setCreatedByName(resolveCreatedByName());
    save(categoryAttribute);
    return getById(categoryAttribute.getId());
  }

  @Transactional
  public CategoryAttribute updateCategoryAttribute(Long id, CategoryAttribute payload) {
    CategoryAttribute existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("类目属性模板不存在");
    }
    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedAt(existing.getCreatedAt());
    updateById(payload);
    return getById(id);
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
