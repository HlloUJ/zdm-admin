package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.Collection;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
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

  public ProductCategoryService(
      CurrentIdentityProvider identityProvider,
      JdbcTemplate jdbcTemplate) {
    this.identityProvider = identityProvider;
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<ProductCategory> listNewestFirst() {
    List<ProductCategory> categories = lambdaQuery()
        .orderByDesc(ProductCategory::getCreatedAt)
        .orderByDesc(ProductCategory::getId)
        .list();
    return attachActualFinishedProductCounts(categories);
  }

  public List<ProductCategory> listNewestFirst(Collection<String> scopes) {
    if (scopes.isEmpty()) {
      return List.of();
    }
    List<ProductCategory> categories = lambdaQuery()
        .in(ProductCategory::getScope, scopes)
        .orderByDesc(ProductCategory::getCreatedAt)
        .orderByDesc(ProductCategory::getId)
        .list();
    return attachActualFinishedProductCounts(categories);
  }

  @Transactional
  public ProductCategory createCategory(ProductCategory category) {
    category.setId(null);
    category.setProductCount(0);
    normalizeAndValidateCategory(category, null);
    category.setCreatedByName(resolveCreatedByName());
    category.setCreatedByAccountId(identityProvider.require().accountId());
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
    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    payload.setCreatedAt(existing.getCreatedAt());
    payload.setProductCount(resolveActualProductCount(existing));
    normalizeAndValidateCategory(payload, id);
    try {
      updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return attachActualFinishedProductCounts(List.of(getById(id))).get(0);
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
    if (java.util.Objects.requireNonNull(jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM category_template_versions WHERE category_id = ?", Long.class, id)) > 0) {
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

  private List<ProductCategory> attachActualFinishedProductCounts(
      List<ProductCategory> categories) {
    if (categories.stream().noneMatch(category -> "finished".equals(category.getScope()))) {
      return categories;
    }
    Map<Long, Integer> countByCategoryId = jdbcTemplate.query(
        """
        SELECT category_id, COUNT(*)
        FROM finished_products
        WHERE category_id IS NOT NULL
        GROUP BY category_id
        """,
        resultSet -> {
          Map<Long, Integer> counts = new HashMap<>();
          while (resultSet.next()) {
            counts.put(resultSet.getLong(1), Math.toIntExact(resultSet.getLong(2)));
          }
          return counts;
        });
    categories.stream()
        .filter(category -> "finished".equals(category.getScope()))
        .forEach(category -> category.setProductCount(
            countByCategoryId.getOrDefault(category.getId(), 0)));
    return categories;
  }

  private int resolveActualProductCount(ProductCategory category) {
    if (!"finished".equals(category.getScope())) {
      return category.getProductCount() == null ? 0 : category.getProductCount();
    }
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM finished_products WHERE category_id = ?",
        Long.class,
        category.getId());
    return count == null ? 0 : Math.toIntExact(count);
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
