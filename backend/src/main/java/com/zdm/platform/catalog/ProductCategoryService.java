package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.Collection;
import java.util.List;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductCategoryService extends ServiceImpl<ProductCategoryMapper, ProductCategory> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;
  private final JdbcTemplate jdbcTemplate;
  private final CategoryAttributeMapper categoryAttributeMapper;

  public ProductCategoryService(
      CurrentIdentityProvider identityProvider,
      JdbcTemplate jdbcTemplate,
      CategoryAttributeMapper categoryAttributeMapper) {
    this.identityProvider = identityProvider;
    this.jdbcTemplate = jdbcTemplate;
    this.categoryAttributeMapper = categoryAttributeMapper;
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
    category.setCreatedByName(resolveCreatedByName());
    save(category);
    return category;
  }

  @Transactional
  public ProductCategory updateCategory(Long id, ProductCategory payload) {
    ProductCategory existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("分类不存在");
    }
    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedAt(existing.getCreatedAt());
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public void deleteCategory(Long id) {
    ProductCategory category = getById(id);
    if (category == null) {
      throw new IllegalArgumentException("分类不存在或已被删除");
    }
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
}
