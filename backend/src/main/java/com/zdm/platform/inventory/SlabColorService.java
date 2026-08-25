package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SlabColorService extends ServiceImpl<SlabColorMapper, SlabColor> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private final SlabColorCategoryMapper categoryMapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabColorService(
      SlabColorCategoryMapper categoryMapper,
      CurrentIdentityProvider identityProvider) {
    this.categoryMapper = categoryMapper;
    this.identityProvider = identityProvider;
  }

  public List<SlabColor> listColors() {
    List<SlabColor> colors = list(Wrappers.<SlabColor>lambdaQuery().orderByDesc(SlabColor::getCreatedAt));
    if (colors.isEmpty()) {
      return colors;
    }
    Map<Long, SlabColorCategory> categories = categoryMapper.selectBatchIds(
        colors.stream().map(SlabColor::getCategoryId).distinct().toList())
        .stream().collect(Collectors.toMap(SlabColorCategory::getId, Function.identity()));
    colors.forEach(color -> {
      SlabColorCategory category = categories.get(color.getCategoryId());
      color.setCategoryName(category == null ? "-" : category.getName());
    });
    return colors;
  }

  @Transactional
  public SlabColor createColor(SlabColor color) {
    color.setId(null);
    requireCategory(color.getCategoryId());
    normalizeAndValidateColorName(color, null);
    color.setCreatedByName(resolveCreatedByName());
    color.setCreatedByAccountId(identityProvider.require().accountId());
    save(color);
    return enrich(color);
  }

  @Transactional
  public SlabColor updateColor(Long id, SlabColor payload) {
    SlabColor existing = requireColor(id);
    requireCategory(payload.getCategoryId());
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidateColorName(payload, id);
    updateById(payload);
    return enrich(requireColor(id));
  }

  @Transactional
  public SlabColor updateStatus(Long id, String status) {
    SlabColor existing = requireColor(id);
    existing.setStatus(status);
    updateById(existing);
    return enrich(requireColor(id));
  }

  @Transactional
  public boolean deleteColor(Long id) {
    requireColor(id);
    return removeById(id);
  }

  public List<SlabColorCategory> listCategories() {
    return categoryMapper.selectList(Wrappers.<SlabColorCategory>lambdaQuery()
        .orderByDesc(SlabColorCategory::getCreatedAt));
  }

  @Transactional
  public SlabColorCategory createCategory(SlabColorCategory category) {
    category.setId(null);
    normalizeAndValidateCategoryName(category, null);
    category.setCreatedByName(resolveCreatedByName());
    category.setCreatedByAccountId(identityProvider.require().accountId());
    categoryMapper.insert(category);
    return category;
  }

  @Transactional
  public SlabColorCategory updateCategory(Long id, SlabColorCategory payload) {
    SlabColorCategory existing = requireCategory(id);
    payload.setId(id);
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidateCategoryName(payload, id);
    categoryMapper.updateById(payload);
    return requireCategory(id);
  }

  @Transactional
  public boolean deleteCategory(Long id) {
    requireCategory(id);
    if (lambdaQuery().eq(SlabColor::getCategoryId, id).count() > 0) {
      throw new IllegalArgumentException("该色系分类已被色系引用，无法删除");
    }
    return categoryMapper.deleteById(id) > 0;
  }

  private SlabColor requireColor(Long id) {
    SlabColor color = getById(id);
    if (color == null) {
      throw new IllegalArgumentException("色系不存在");
    }
    return color;
  }

  private SlabColorCategory requireCategory(Long id) {
    SlabColorCategory category = categoryMapper.selectById(id);
    if (category == null) {
      throw new IllegalArgumentException("色系分类不存在");
    }
    return category;
  }

  private SlabColor enrich(SlabColor color) {
    color.setCategoryName(requireCategory(color.getCategoryId()).getName());
    return color;
  }

  private void normalizeAndValidateColorName(SlabColor color, Long excludedId) {
    String name = color.getName().trim();
    color.setName(name);
    var query = lambdaQuery().eq(SlabColor::getName, name);
    if (excludedId != null) {
      query.ne(SlabColor::getId, excludedId);
    }
    if (query.count() > 0) {
      throw new IllegalArgumentException("色系名称已存在");
    }
  }

  private void normalizeAndValidateCategoryName(SlabColorCategory category, Long excludedId) {
    String name = category.getName().trim();
    category.setName(name);
    var query = Wrappers.<SlabColorCategory>lambdaQuery().eq(SlabColorCategory::getName, name);
    if (excludedId != null) {
      query.ne(SlabColorCategory::getId, excludedId);
    }
    if (categoryMapper.selectCount(query) > 0) {
      throw new IllegalArgumentException("色系分类名称已存在");
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName() : DEFAULT_CREATED_BY_NAME;
  }

}
