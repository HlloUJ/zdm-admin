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
public class ProductAttributeValueService
    extends ServiceImpl<ProductAttributeValueMapper, ProductAttributeValue> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;
  public ProductAttributeValueService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  public List<ProductAttributeValue> listWithUseCounts(Collection<String> scopes) {
    if (scopes.isEmpty()) {
      return List.of();
    }
    Set<String> visibleScopes = Set.copyOf(scopes);
    return baseMapper.selectWithUseCounts().stream()
        .filter(value -> visibleScopes.contains(value.getScope()))
        .toList();
  }

  @Transactional
  public ProductAttributeValue createValue(ProductAttributeValue value) {
    value.setId(null);
    value.setCreatedByName(resolveCreatedByName());
    value.setCreatedByAccountId(identityProvider.require().accountId());
    save(value);
    return getById(value.getId());
  }

  @Transactional
  public ProductAttributeValue updateStatus(Long id, String status) {
    ProductAttributeValue existing = requireValue(id);
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteValue(Long id) {
    requireValue(id);
    return removeById(id);
  }

  private ProductAttributeValue requireValue(Long id) {
    ProductAttributeValue value = getById(id);
    if (value == null) {
      throw new IllegalArgumentException("属性值不存在或已被删除");
    }
    return value;
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
