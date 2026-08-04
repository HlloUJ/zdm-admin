package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class CategoryAttributeService extends ServiceImpl<CategoryAttributeMapper, CategoryAttribute> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final int MAX_SKU_ATTRIBUTE_COUNT = 4;
  private static final String SKU_ATTRIBUTE_LIMIT_MESSAGE = "参与SKU组合的属性最多只能开启4个";

  private final CurrentIdentityProvider identityProvider;

  public CategoryAttributeService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  @Transactional
  public CategoryAttribute createCategoryAttribute(CategoryAttribute categoryAttribute) {
    validateSkuAttributeLimit(categoryAttribute.getCategoryId(), null, categoryAttribute.getSkuFlag());
    categoryAttribute.setId(null);
    categoryAttribute.setStatus("disabled");
    categoryAttribute.setPublishStatus("unpublished");
    categoryAttribute.setCreatedByName(resolveCreatedByName());
    save(categoryAttribute);
    return getById(categoryAttribute.getId());
  }

  @Transactional
  public List<CategoryAttribute> createCategoryAttributes(CategoryAttributeBatchRequest request) {
    List<Long> attributeIds = new ArrayList<>(new LinkedHashSet<>(request.attributeIds()));
    boolean alreadyBound = lambdaQuery()
        .eq(CategoryAttribute::getCategoryId, request.categoryId())
        .in(CategoryAttribute::getAttributeId, attributeIds)
        .count() > 0;
    if (alreadyBound) {
      throw new IllegalArgumentException("部分属性已绑定，请刷新后重试");
    }

    CategoryAttribute lastBinding = lambdaQuery()
        .eq(CategoryAttribute::getCategoryId, request.categoryId())
        .orderByDesc(CategoryAttribute::getSortOrder)
        .last("LIMIT 1")
        .one();
    int nextSortOrder = lastBinding == null || lastBinding.getSortOrder() == null
        ? 1
        : lastBinding.getSortOrder() + 1;
    String createdByName = resolveCreatedByName();
    List<CategoryAttribute> createdBindings = new ArrayList<>();
    for (Long attributeId : attributeIds) {
      CategoryAttribute binding = new CategoryAttribute();
      binding.setCategoryId(request.categoryId());
      binding.setAttributeId(attributeId);
      binding.setRequiredFlag(false);
      binding.setSkuFlag(false);
      binding.setSortOrder(nextSortOrder++);
      binding.setStatus("disabled");
      binding.setPublishStatus("unpublished");
      binding.setCreatedByName(createdByName);
      createdBindings.add(binding);
    }
    saveBatch(createdBindings);
    return lambdaQuery()
        .eq(CategoryAttribute::getCategoryId, request.categoryId())
        .in(CategoryAttribute::getAttributeId, attributeIds)
        .orderByAsc(CategoryAttribute::getSortOrder)
        .list();
  }

  @Transactional
  public CategoryAttribute updateCategoryAttribute(Long id, CategoryAttribute payload) {
    CategoryAttribute existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("类目属性模板不存在");
    }
    validateSkuAttributeLimit(payload.getCategoryId(), id, payload.getSkuFlag());
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setPublishStatus(existing.getPublishStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedAt(existing.getCreatedAt());
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public CategoryAttribute updatePublishStatus(Long id, String publishStatus) {
    CategoryAttribute existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("类目属性模板不存在");
    }
    existing.setPublishStatus(publishStatus);
    updateById(existing);
    return getById(id);
  }

  private void validateSkuAttributeLimit(Long categoryId, Long excludedId, Boolean skuFlag) {
    if (!Boolean.TRUE.equals(skuFlag)) {
      return;
    }
    var query = lambdaQuery()
        .eq(CategoryAttribute::getCategoryId, categoryId)
        .eq(CategoryAttribute::getSkuFlag, true);
    if (excludedId != null) {
      query.ne(CategoryAttribute::getId, excludedId);
    }
    if (query.count() >= MAX_SKU_ATTRIBUTE_COUNT) {
      throw new IllegalArgumentException(SKU_ATTRIBUTE_LIMIT_MESSAGE);
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }
}
