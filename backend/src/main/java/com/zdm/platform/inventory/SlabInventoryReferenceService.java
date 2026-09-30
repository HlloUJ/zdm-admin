package com.zdm.platform.inventory;

import com.zdm.platform.common.SlabSupplierOptionProvider;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class SlabInventoryReferenceService {
  private final SlabTextureService textureService;
  private final SlabColorService colorService;
  private final SlabGradeService gradeService;
  private final SlabOriginService originService;
  private final SlabVarietyService varietyService;
  private final SlabSupplierOptionProvider slabSupplierOptionProvider;
  private final StoreLevelPricingDirectory storeLevelDirectory;
  private final CurrentIdentityProvider identityProvider;

  public SlabInventoryReferenceService(
      SlabTextureService textureService,
      SlabColorService colorService,
      SlabGradeService gradeService,
      SlabOriginService originService,
      SlabVarietyService varietyService,
      SlabSupplierOptionProvider slabSupplierOptionProvider,
      StoreLevelPricingDirectory storeLevelDirectory,
      CurrentIdentityProvider identityProvider) {
    this.textureService = textureService;
    this.colorService = colorService;
    this.gradeService = gradeService;
    this.originService = originService;
    this.varietyService = varietyService;
    this.slabSupplierOptionProvider = slabSupplierOptionProvider;
    this.storeLevelDirectory = storeLevelDirectory;
    this.identityProvider = identityProvider;
  }

  public SlabPublishOptions listPublishOptions() {
    List<SlabPublishOption> origins = originService.lambdaQuery()
        .eq(SlabOrigin::getStatus, "enabled")
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), SlabOrigin::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByAsc(SlabOrigin::getName)
        .list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()))
        .toList();
    List<SlabPublishOption> varieties = varietyService.lambdaQuery()
        .eq(SlabVariety::getStatus, "enabled")
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), SlabVariety::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByAsc(SlabVariety::getName)
        .list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()))
        .toList();
    List<SlabPublishOption> textures = textureService.lambdaQuery()
        .eq(SlabTexture::getStatus, "enabled")
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), SlabTexture::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByAsc(SlabTexture::getName)
        .list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()))
        .toList();
    Map<Long, List<SlabPublishOption>> colorsByCategory = com.zdm.platform.security.DataScope.filter(identityProvider.require(), colorService.listColors()).stream()
        .filter(item -> "enabled".equals(item.getStatus()))
        .collect(Collectors.groupingBy(
            SlabColor::getCategoryId,
            Collectors.mapping(
                item -> new SlabPublishOption(item.getId(), item.getName(), null, item.getStatus()),
                Collectors.toList())));
    List<SlabPublishColorCategoryOption> colorCategories = com.zdm.platform.security.DataScope.filter(identityProvider.require(), colorService.listCategories()).stream()
        .filter(category -> "enabled".equals(category.getStatus()))
        .map(category -> new SlabPublishColorCategoryOption(
            category.getId(),
            category.getName(),
            category.getStatus(),
            colorsByCategory.getOrDefault(category.getId(), List.of())))
        .filter(category -> !category.children().isEmpty())
        .toList();
    List<SlabPublishOption> grades = gradeService.lambdaQuery()
        .eq(SlabGrade::getStatus, "enabled")
        .eq(!com.zdm.platform.security.DataScope.isAll(identityProvider.require()), SlabGrade::getCreatedByAccountId, identityProvider.require().accountId())
        .orderByAsc(SlabGrade::getSortOrder)
        .orderByAsc(SlabGrade::getId)
        .list().stream()
        .map(item -> new SlabPublishOption(item.getId(), item.getCode(), item.getName(), item.getStatus()))
        .toList();
    List<SlabPublishOption> suppliers = slabSupplierOptionProvider.listSelectableSlabSuppliers().stream()
        .map(item -> new SlabPublishOption(item.id(), item.label(), null, item.status()))
        .toList();
    List<SlabPublishOption> storeLevels = storeLevelDirectory.listOperationalPricingLevels().stream()
        .map(item -> new SlabPublishOption(item.id(), item.name(), null, "enabled"))
        .toList();
    return new SlabPublishOptions(varieties, origins, textures, colorCategories, grades, suppliers, storeLevels);
  }

  public void validateSelectableReferences(SlabInventory inventory, SlabInventory existing) {
    requireEnabledOrUnchanged(
        inventory.getOriginId(), existing == null ? null : existing.getOriginId(), originService::getById, "产地");
    requireEnabledOrUnchanged(
        inventory.getVarietyId(), existing == null ? null : existing.getVarietyId(), varietyService::getById, "品种");
    requireEnabledOrUnchanged(
        inventory.getTextureId(), existing == null ? null : existing.getTextureId(), textureService::getById, "纹理");
    SlabColor color = requireEnabledOrUnchanged(
        inventory.getColorId(), existing == null ? null : existing.getColorId(), colorService::getById, "色系");
    requireEnabledOrUnchanged(
        inventory.getGradeId(), existing == null ? null : existing.getGradeId(), gradeService::getById, "等级");

    if (inventory.getSupplierId() != null
        && !Objects.equals(inventory.getSupplierId(), existing == null ? null : existing.getSupplierId())
        && !slabSupplierOptionProvider.isSelectableSlabSupplier(inventory.getSupplierId())) {
      throw new IllegalArgumentException("供应商不存在、已停用或不支持大板供货");
    }
    if (color != null) {
      SlabColorCategory category = com.zdm.platform.security.DataScope.filter(identityProvider.require(), colorService.listCategories()).stream()
          .filter(item -> Objects.equals(item.getId(), color.getCategoryId()))
          .findFirst()
          .orElse(null);
      boolean unchanged = existing != null && Objects.equals(color.getId(), existing.getColorId());
      if ((category == null || !"enabled".equals(category.getStatus())) && !unchanged) {
        throw new IllegalArgumentException("色系分类已停用，不能选择该色系");
      }
    }
  }

  private <T extends com.zdm.platform.common.BaseEntity> T requireEnabledOrUnchanged(
      Long requestedId,
      Long existingId,
      java.util.function.Function<Long, T> finder,
      String label) {
    if (requestedId == null) {
      return null;
    }
    T entity = finder.apply(requestedId);
    if (entity == null) {
      throw new IllegalArgumentException(label + "不存在");
    }
    if (!"enabled".equals(entity.getStatus()) && !Objects.equals(requestedId, existingId)) {
      throw new IllegalArgumentException(label + "已停用，不能选择");
    }
    return entity;
  }

}
