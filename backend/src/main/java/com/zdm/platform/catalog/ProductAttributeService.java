package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductAttributeService extends ServiceImpl<ProductAttributeMapper, ProductAttribute> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String DUPLICATE_NAME_MESSAGE = "属性名称已存在";

  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public ProductAttributeService(
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
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
    attribute.setName(attribute.getName().trim());
    if (lambdaQuery().eq(ProductAttribute::getName, attribute.getName()).count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
    attribute.setCreatedByName(resolveCreatedByName());
    attribute.setCreatedByAccountId(ownershipGuard.currentAccountId());
    try {
      save(attribute);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return getById(attribute.getId());
  }

  @Transactional
  public ProductAttribute updateStatus(Long id, String status) {
    ProductAttribute existing = requireAttribute(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteAttribute(Long id) {
    ProductAttribute existing = requireAttribute(id);
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    return removeById(id);
  }

  private ProductAttribute requireAttribute(Long id) {
    ProductAttribute attribute = getById(id);
    if (attribute == null) {
      throw new IllegalArgumentException("属性不存在或已被删除");
    }
    return attribute;
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
