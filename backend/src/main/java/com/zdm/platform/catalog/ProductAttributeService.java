package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.Collection;
import java.util.List;
import java.util.Set;
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

  public List<ProductAttribute> listWithTemplateCounts(Collection<String> scopes) {
    if (scopes.isEmpty()) {
      return List.of();
    }
    Set<String> visibleScopes = Set.copyOf(scopes);
    return baseMapper.selectWithTemplateCounts().stream()
        .filter(attribute -> visibleScopes.contains(attribute.getScope()))
        .toList();
  }

  @Transactional
  public ProductAttribute createAttribute(ProductAttribute attribute) {
    attribute.setId(null);
    attribute.setCreatedByName(resolveCreatedByName());
    save(attribute);
    return getById(attribute.getId());
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
