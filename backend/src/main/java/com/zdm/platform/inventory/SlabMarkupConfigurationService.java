package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SlabMarkupConfigurationService {
  private static final String DUPLICATE_LEVEL_MESSAGE = "该门店级别已配置大板价格";

  private final SlabMarkupConfigurationMapper mapper;
  private final CurrentIdentityProvider identityProvider;
  private final StoreLevelPricingDirectory storeLevelDirectory;
  private final SlabPriceConfigurationSyncService priceSyncService;

  public SlabMarkupConfigurationService(
      SlabMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      StoreLevelPricingDirectory storeLevelDirectory,
      SlabPriceConfigurationSyncService priceSyncService) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.storeLevelDirectory = storeLevelDirectory;
    this.priceSyncService = priceSyncService;
  }

  public List<SlabMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<SlabMarkupConfiguration>lambdaQuery();
    query.ne(SlabMarkupConfiguration::getName, "指导价")
        .eq(SlabMarkupConfiguration::getLegacySeeded, false);
    if (enabledOnly) {
      query.eq(SlabMarkupConfiguration::getStatus, "enabled");
    }
    List<SlabMarkupConfiguration> configurations = mapper.selectList(query
        .orderByAsc(SlabMarkupConfiguration::getSortOrder)
        .orderByDesc(SlabMarkupConfiguration::getCreatedAt)
        .orderByDesc(SlabMarkupConfiguration::getId));
    configurations.forEach(this::enrich);
    return configurations;
  }

  @Transactional
  public SlabMarkupConfiguration createConfiguration(SlabMarkupConfiguration payload) {
    CurrentIdentity identity = requirePlatformScope();
    StoreLevelPricingDirectory.Level level = storeLevelDirectory.requireEnabledLevel(payload.getStoreLevelId());
    payload.setId(null);
    payload.setName(level.name());
    payload.setStatus("enabled");
    payload.setSortOrder(nextSortOrder());
    payload.setCreatedByName(identity.displayName());
    payload.setCreatedByAccountId(identity.accountId());
    validateUniqueStoreLevel(payload.getStoreLevelId(), null);
    try {
      mapper.insert(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE, exception);
    }
    SlabMarkupConfiguration created = requireConfiguration(payload.getId());
    created.setSynchronizedPriceCount(priceSyncService.backfillMissingPrices(created));
    enrichUsage(created);
    return created;
  }

  @Transactional
  public SlabMarkupConfiguration updateConfiguration(
      Long id,
      SlabMarkupConfiguration payload) {
    requirePlatformScope();
    SlabMarkupConfiguration existing = requireConfiguration(id);
    payload.setId(id);
    payload.setStoreLevelId(existing.getStoreLevelId());
    payload.setName(existing.getName());
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueStoreLevel(payload.getStoreLevelId(), id);
    try {
      mapper.updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE, exception);
    }
    SlabMarkupConfiguration updated = requireConfiguration(id);
    updated.setSynchronizedPriceCount(priceSyncService.refreshAutoPrices(updated));
    enrichUsage(updated);
    return updated;
  }

  @Transactional
  public SlabMarkupConfiguration updateStatus(Long id, String status) {
    requirePlatformScope();
    if (!List.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("价格配置状态不正确");
    }
    SlabMarkupConfiguration existing = requireConfiguration(id);
    existing.setStatus(status);
    mapper.updateById(existing);
    SlabMarkupConfiguration updated = requireConfiguration(id);
    int synchronizedCount = 0;
    if ("enabled".equals(status)) {
      synchronizedCount += priceSyncService.refreshAutoPrices(updated);
      synchronizedCount += priceSyncService.backfillMissingPrices(updated);
    }
    updated.setSynchronizedPriceCount(synchronizedCount);
    enrichUsage(updated);
    return updated;
  }

  @Transactional
  public List<SlabMarkupConfiguration> reorderConfigurations(List<Long> orderedIds) {
    requirePlatformScope();
    List<SlabMarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<SlabMarkupConfiguration>lambdaQuery()
            .eq(SlabMarkupConfiguration::getLegacySeeded, false));
    if (orderedIds == null || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交当前全部大板价格配置");
    }
    Map<Long, SlabMarkupConfiguration> configurationsById = configurations.stream()
        .collect(Collectors.toMap(SlabMarkupConfiguration::getId, Function.identity()));
    if (!configurationsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("大板价格配置顺序与当前数据不一致");
    }
    for (int index = 0; index < orderedIds.size(); index += 1) {
      SlabMarkupConfiguration configuration = configurationsById.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(false);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    SlabMarkupConfiguration existing = requireConfiguration(id);
    long referenceCount = priceSyncService.countAutoReferences(existing.getId());
    if (referenceCount > 0) {
      throw new IllegalArgumentException(
          "该价格配置正在被" + referenceCount + "条大板价格使用，不能删除，请先停用");
    }
    mapper.deleteById(id);
  }

  public SlabMarkupConfiguration requireConfiguration(Long id) {
    SlabMarkupConfiguration configuration = mapper.selectById(id);
    if (configuration == null) {
      throw new IllegalArgumentException("加价配置不存在");
    }
    enrich(configuration);
    return configuration;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护加价配置");
    }
    return identity;
  }

  private void validateUniqueStoreLevel(Long storeLevelId, Long excludedId) {
    var query = Wrappers.<SlabMarkupConfiguration>lambdaQuery()
        .eq(SlabMarkupConfiguration::getStoreLevelId, storeLevelId);
    if (excludedId != null) {
      query.ne(SlabMarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE);
    }
  }

  private void enrich(SlabMarkupConfiguration configuration) {
    StoreLevelPricingDirectory.Level level = storeLevelDirectory.findLevel(configuration.getStoreLevelId());
    if (level == null) {
      throw new IllegalStateException("大板价格配置关联的门店级别不存在");
    }
    configuration.setName(level.name());
    enrichUsage(configuration);
  }

  private void enrichUsage(SlabMarkupConfiguration configuration) {
    configuration.setAutoReferenceCount(priceSyncService.countAutoReferences(configuration.getId()));
    configuration.setManualPriceCount(priceSyncService.countManualPrices(configuration.getStoreLevelId()));
  }

  private int nextSortOrder() {
    SlabMarkupConfiguration lastConfiguration = mapper.selectOne(
        Wrappers.<SlabMarkupConfiguration>lambdaQuery()
            .eq(SlabMarkupConfiguration::getLegacySeeded, false)
            .orderByDesc(SlabMarkupConfiguration::getSortOrder)
            .last("LIMIT 1"));
    return lastConfiguration == null || lastConfiguration.getSortOrder() == null
        ? 1
        : lastConfiguration.getSortOrder() + 1;
  }
}
