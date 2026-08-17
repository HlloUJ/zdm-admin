package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class SlabInventoryService extends ServiceImpl<SlabInventoryMapper, SlabInventory> {
  private final SlabTextureService textureService;
  private final SlabColorService colorService;
  private final SlabGradeService gradeService;

  public SlabInventoryService(
      SlabTextureService textureService,
      SlabColorService colorService,
      SlabGradeService gradeService) {
    this.textureService = textureService;
    this.colorService = colorService;
    this.gradeService = gradeService;
  }

  public SlabPublishOptions listPublishOptions() {
    List<SlabPublishOption> textures = textureService.list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()))
        .toList();
    Map<Long, List<SlabPublishOption>> colorsByCategory = colorService.listColors().stream()
        .collect(Collectors.groupingBy(
            SlabColor::getCategoryId,
            Collectors.mapping(
                item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()),
                Collectors.toList())));
    List<SlabPublishColorCategoryOption> colorCategories = colorService.listCategories().stream()
        .map(category -> new SlabPublishColorCategoryOption(
            category.getId(),
            category.getName(),
            category.getStatus(),
            colorsByCategory.getOrDefault(category.getId(), List.of())))
        .filter(category -> !category.children().isEmpty())
        .toList();
    List<SlabPublishOption> grades = gradeService.list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getCode(), item.getName(), item.getStatus()))
        .toList();
    return new SlabPublishOptions(textures, colorCategories, grades);
  }

  public void validateReferences(SlabInventory inventory) {
    if (inventory.getTextureId() != null && textureService.getById(inventory.getTextureId()) == null) {
      throw new IllegalArgumentException("纹理不存在");
    }
    if (inventory.getColorId() != null && colorService.getById(inventory.getColorId()) == null) {
      throw new IllegalArgumentException("色系不存在");
    }
    if (inventory.getGradeId() != null && gradeService.getById(inventory.getGradeId()) == null) {
      throw new IllegalArgumentException("等级不存在");
    }
  }
}
