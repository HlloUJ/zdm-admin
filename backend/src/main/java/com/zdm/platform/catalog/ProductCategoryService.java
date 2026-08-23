package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.Collection;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductCategoryService extends ServiceImpl<ProductCategoryMapper, ProductCategory> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String DUPLICATE_NAME_MESSAGE = "同级分类名称不能重复";

  private final CurrentIdentityProvider identityProvider;
  private final JdbcTemplate jdbcTemplate;
  private final CategoryAttributeMapper categoryAttributeMapper;
  private final CreatorOwnershipGuard ownershipGuard;

  public ProductCategoryService(
      CurrentIdentityProvider identityProvider,
      JdbcTemplate jdbcTemplate,
      CategoryAttributeMapper categoryAttributeMapper,
      CreatorOwnershipGuard ownershipGuard) {
    this.identityProvider = identityProvider;
    this.jdbcTemplate = jdbcTemplate;
    this.categoryAttributeMapper = categoryAttributeMapper;
    this.ownershipGuard = ownershipGuard;
  }

  public List<ProductCategory> listNewestFirst() {
    return lambdaQuery()
        .orderByDesc(ProductCategory::getCreatedAt)
        .orderByDesc(ProductCategory::getId)
        .list();
  }

  public List<ProductCategory> listNewestFirst(Collection<String> scopes) {
    if (scopes.isEmpty()) {
      return List.of();
    }
    return lambdaQuery()
        .in(ProductCategory::getScope, scopes)
        .orderByDesc(ProductCategory::getCreatedAt)
        .orderByDesc(ProductCategory::getId)
        .list();
  }

  @Transactional
  public ProductCategory createCategory(ProductCategory category) {
    category.setId(null);
    normalizeAndValidateCategory(category, null);
    category.setCreatedByName(resolveCreatedByName());
    category.setCreatedByAccountId(ownershipGuard.currentAccountId());
    try {
      save(category);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return category;
  }

  @Transactional
  public ProductCategory updateCategory(Long id, ProductCategory payload) {
    ProductCategory existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("分类不存在");
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    payload.setCreatedAt(existing.getCreatedAt());
    normalizeAndValidateCategory(payload, id);
    try {
      updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return getById(id);
  }

  @Transactional
  public void deleteCategory(Long id) {
    ProductCategory category = getById(id);
    if (category == null) {
      throw new IllegalArgumentException("分类不存在或已被删除");
    }
    ownershipGuard.requireCreator(category.getCreatedByAccountId(), category.getCreatedByName());
    if (lambdaQuery().eq(ProductCategory::getParentId, id).count() > 0) {
      throw new IllegalArgumentException("该分类包含下级分类，请先删除或转移下级分类");
    }
    Long referencedProductCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM finished_products WHERE category_id = ?",
        Long.class,
        id);
    if (referencedProductCount != null && referencedProductCount > 0) {
      throw new IllegalArgumentException("该分类已关联商品，不能删除，请先停用该分类");
    }
    if (categoryAttributeMapper.selectCount(
        Wrappers.lambdaQuery(CategoryAttribute.class).eq(CategoryAttribute::getCategoryId, id)) > 0) {
      throw new IllegalArgumentException("该分类已配置发布属性模板，不能删除，请先移除模板配置");
    }
    if (!removeById(id)) {
      throw new IllegalArgumentException("分类删除失败，请刷新后重试");
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }

  private void normalizeAndValidateCategory(ProductCategory category, Long excludedCategoryId) {
    category.setName(category.getName().trim());
    validateParentScope(category);
    var duplicateQuery = lambdaQuery()
        .eq(ProductCategory::getScope, category.getScope())
        .eq(ProductCategory::getName, category.getName());
    if (category.getParentId() == null) {
      duplicateQuery.isNull(ProductCategory::getParentId);
    } else {
      duplicateQuery.eq(ProductCategory::getParentId, category.getParentId());
    }
    if (excludedCategoryId != null) {
      duplicateQuery.ne(ProductCategory::getId, excludedCategoryId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private void validateParentScope(ProductCategory category) {
    if (category.getParentId() == null) {
      return;
    }
    ProductCategory parent = getById(category.getParentId());
    if (parent == null) {
      throw new IllegalArgumentException("上级分类不存在");
    }
    if (!parent.getScope().equals(category.getScope())) {
      throw new IllegalArgumentException("上级分类与当前分类类型不一致");
    }
  }
}
