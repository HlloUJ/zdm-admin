package com.zdm.platform.catalog;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CategoryAttributeValueBindingService {
  private final CategoryAttributeMapper categoryAttributeMapper;
  private final ProductAttributeService attributeService;
  private final ProductAttributeValueService attributeValueService;
  private final CategoryAttributeValueBindingMapper bindingMapper;

  public CategoryAttributeValueBindingService(
      CategoryAttributeMapper categoryAttributeMapper,
      ProductAttributeService attributeService,
      ProductAttributeValueService attributeValueService,
      CategoryAttributeValueBindingMapper bindingMapper) {
    this.categoryAttributeMapper = categoryAttributeMapper;
    this.attributeService = attributeService;
    this.attributeValueService = attributeValueService;
    this.bindingMapper = bindingMapper;
  }

  public List<CategoryAttributeValueOption> listOptions(Long categoryAttributeId) {
    CategoryAttribute categoryAttribute = requireCategoryAttribute(categoryAttributeId);
    requireStandardOptionAttribute(categoryAttribute.getAttributeId());
    Set<Long> selectedIds = selectedValueIds(categoryAttributeId);
    return attributeValueService.lambdaQuery()
        .eq(ProductAttributeValue::getAttributeId, categoryAttribute.getAttributeId())
        .eq(ProductAttributeValue::getStatus, "enabled")
        .orderByAsc(ProductAttributeValue::getId)
        .list()
        .stream()
        .map(value -> new CategoryAttributeValueOption(
            value.getId(), value.getValue(), value.getCode(), value.getStatus(), selectedIds.contains(value.getId())))
        .toList();
  }

  @Transactional
  public List<CategoryAttributeValueOption> replaceBindings(
      Long categoryAttributeId,
      CategoryAttributeValueBindingRequest request) {
    CategoryAttribute categoryAttribute = requireCategoryAttribute(categoryAttributeId);
    if ("published".equals(categoryAttribute.getPublishStatus())) {
      throw new IllegalArgumentException("请先取消发布后再修改属性配置");
    }
    requireStandardOptionAttribute(categoryAttribute.getAttributeId());

    List<Long> valueIds = new ArrayList<>(new LinkedHashSet<>(request.valueIds()));
    if (!valueIds.isEmpty()) {
      List<ProductAttributeValue> values = attributeValueService.listByIds(valueIds);
      boolean invalidValue = values.size() != valueIds.size() || values.stream().anyMatch(value ->
          !categoryAttribute.getAttributeId().equals(value.getAttributeId()) || !"enabled".equals(value.getStatus()));
      if (invalidValue) {
        throw new IllegalArgumentException("只能绑定该属性下已启用的选项值");
      }
    }

    bindingMapper.delete(Wrappers.<CategoryAttributeValueBinding>lambdaQuery()
        .eq(CategoryAttributeValueBinding::getCategoryAttributeId, categoryAttributeId));
    for (Long valueId : valueIds) {
      CategoryAttributeValueBinding binding = new CategoryAttributeValueBinding();
      binding.setCategoryAttributeId(categoryAttributeId);
      binding.setAttributeValueId(valueId);
      bindingMapper.insert(binding);
    }
    return listOptions(categoryAttributeId);
  }

  public boolean hasEnabledBinding(Long categoryAttributeId) {
    return bindingMapper.countEnabledBindings(categoryAttributeId) > 0;
  }

  public Map<Long, Long> enabledBindingCounts(List<Long> categoryAttributeIds) {
    if (categoryAttributeIds.isEmpty()) {
      return Map.of();
    }
    return bindingMapper.countEnabledBindingsByCategoryAttributeIds(categoryAttributeIds).stream()
        .collect(Collectors.toMap(
            CategoryAttributeValueBindingCount::categoryAttributeId,
            CategoryAttributeValueBindingCount::optionCount));
  }

  private Set<Long> selectedValueIds(Long categoryAttributeId) {
    return bindingMapper.selectList(Wrappers.<CategoryAttributeValueBinding>lambdaQuery()
            .eq(CategoryAttributeValueBinding::getCategoryAttributeId, categoryAttributeId))
        .stream()
        .map(CategoryAttributeValueBinding::getAttributeValueId)
        .collect(Collectors.toCollection(LinkedHashSet::new));
  }

  private CategoryAttribute requireCategoryAttribute(Long categoryAttributeId) {
    CategoryAttribute categoryAttribute = categoryAttributeMapper.selectById(categoryAttributeId);
    if (categoryAttribute == null) {
      throw new IllegalArgumentException("分类属性模板不存在");
    }
    return categoryAttribute;
  }

  private void requireStandardOptionAttribute(Long attributeId) {
    ProductAttribute attribute = attributeService.getById(attributeId);
    if (attribute == null || !"select".equals(attribute.getValueType())) {
      throw new IllegalArgumentException("只有标准选项类型属性才能绑定选项值");
    }
  }
}
