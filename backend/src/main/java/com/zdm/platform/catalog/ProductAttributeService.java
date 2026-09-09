package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDateTime;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class ProductAttributeService extends ServiceImpl<ProductAttributeMapper, ProductAttribute> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String TEMPLATE_REFERENCED_MESSAGE = "该属性已被分类属性模板使用，不能删除";
  private static final String PRODUCT_REFERENCED_MESSAGE =
      "该属性仍被未售完商品使用，不能删除，请先处理关联商品。";

  private final CurrentIdentityProvider identityProvider;
  private final JdbcTemplate jdbcTemplate;

  public ProductAttributeService(
      CurrentIdentityProvider identityProvider,
      JdbcTemplate jdbcTemplate) {
    this.identityProvider = identityProvider;
    this.jdbcTemplate = jdbcTemplate;
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
    attribute.setDeletedAt(null);
    attribute.setDeletedByName(null);
    attribute.setDeletedByAccountId(null);
    attribute.setCreatedByName(resolveCreatedByName());
    attribute.setCreatedByAccountId(identityProvider.require().accountId());
    try {
      save(attribute);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException("属性名称已存在，请勿重复创建", exception);
    }
    return getById(attribute.getId());
  }

  @Transactional
  public ProductAttribute updateStatus(Long id, String status) {
    ProductAttribute existing = requireActiveAttributeForUpdate(id);
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public ProductAttributeDeletePreview previewDelete(Long id) {
    requireAttribute(id);
    List<String> templateScopes = jdbcTemplate.queryForList(
        """
        SELECT DISTINCT category.scope
        FROM category_template_versions template
        JOIN product_categories category ON category.id = template.category_id
        JOIN JSON_TABLE(template.content, '$[*]' COLUMNS(attribute_id BIGINT PATH '$.attributeId')) binding ON TRUE
        WHERE binding.attribute_id = ?
        ORDER BY category.scope
        """,
        String.class,
        id);
    long valueCount = referenceCount("product_attribute_values", id);
    long unfinishedProductCount = productReferenceCount(id, false);
    long soldOutProductCount = productReferenceCount(id, true);
    if (!templateScopes.isEmpty()) {
      return new ProductAttributeDeletePreview(
          "blocked",
          valueCount,
          unfinishedProductCount,
          soldOutProductCount,
          templateScopes,
          TEMPLATE_REFERENCED_MESSAGE);
    }
    if (unfinishedProductCount > 0) {
      return new ProductAttributeDeletePreview(
          "blocked",
          valueCount,
          unfinishedProductCount,
          soldOutProductCount,
          templateScopes,
          PRODUCT_REFERENCED_MESSAGE);
    }
    String deletionMode = soldOutProductCount > 0 ? "business" : "physical";
    return new ProductAttributeDeletePreview(
        deletionMode,
        valueCount,
        unfinishedProductCount,
        soldOutProductCount,
        templateScopes,
        null);
  }

  @Transactional
  public ProductAttributeDeleteResult deleteAttribute(Long id) {
    ProductAttribute existing = requireActiveAttributeForUpdate(id);
    ProductAttributeDeletePreview preview = previewDelete(id);
    if ("blocked".equals(preview.deletionMode())) {
      throw new IllegalArgumentException(preview.message());
    }
    try {
      if ("business".equals(preview.deletionMode())) {
        CurrentIdentity identity = identityProvider.require();
        existing.setStatus("disabled");
        existing.setDeletedAt(LocalDateTime.now());
        existing.setDeletedByName(identity.displayName());
        existing.setDeletedByAccountId(identity.accountId());
        updateById(existing);
        jdbcTemplate.update(
            "UPDATE product_attribute_values SET status = 'disabled' WHERE attribute_id = ?",
            id);
        return new ProductAttributeDeleteResult("business", preview.attributeValueCount());
      }
      int deletedValueCount = jdbcTemplate.update(
          "DELETE FROM product_attribute_values WHERE attribute_id = ?",
          id);
      if (!removeById(id)) {
        throw new IllegalArgumentException("属性删除失败，请刷新后重试");
      }
      return new ProductAttributeDeleteResult("physical", deletedValueCount);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException("该属性仍被业务数据引用，不能删除", exception);
    }
  }

  public ProductAttribute getActiveById(Long id) {
    return id == null ? null : lambdaQuery()
        .eq(ProductAttribute::getId, id)
        .isNull(ProductAttribute::getDeletedAt)
        .one();
  }

  public ProductAttribute getActiveByIdForShare(Long id) {
    return id == null ? null : baseMapper.selectActiveByIdForShare(id);
  }

  private long referenceCount(String tableName, Long attributeId) {
    Long count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM " + tableName + " WHERE attribute_id = ?",
        Long.class,
        attributeId);
    return count == null ? 0 : count;
  }

  private long productReferenceCount(Long attributeId, boolean soldOut) {
    String query = soldOut
        ? """
            SELECT COUNT(DISTINCT product.id)
            FROM finished_product_attribute_entries entry
            JOIN finished_products product ON product.id = entry.finished_product_id
            WHERE entry.attribute_id = ?
              AND product.status = 'soldOut'
            """
        : """
            SELECT COUNT(DISTINCT product.id)
            FROM finished_product_attribute_entries entry
            JOIN finished_products product ON product.id = entry.finished_product_id
            WHERE entry.attribute_id = ?
              AND product.status <> 'soldOut'
            """;
    Long count = jdbcTemplate.queryForObject(
        query,
        Long.class,
        attributeId);
    return count == null ? 0 : count;
  }

  private ProductAttribute requireAttribute(Long id) {
    ProductAttribute attribute = getActiveById(id);
    if (attribute == null) {
      throw new IllegalArgumentException("属性不存在或已被删除");
    }
    return attribute;
  }

  private ProductAttribute requireActiveAttributeForUpdate(Long id) {
    ProductAttribute attribute = id == null ? null : baseMapper.selectActiveByIdForUpdate(id);
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
