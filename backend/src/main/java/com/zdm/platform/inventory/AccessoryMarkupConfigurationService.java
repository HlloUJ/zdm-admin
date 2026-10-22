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
public class AccessoryMarkupConfigurationService {
  @org.springframework.beans.factory.annotation.Autowired
  private com.zdm.platform.account.CreatorNames creatorNames;
  private static final String DUPLICATE_LEVEL_MESSAGE = "该门店级别已配置配件价格";
  private final AccessoryMarkupConfigurationMapper mapper;
  private final AccessoryPriceConfigurationSyncService priceSyncService;
  private final CurrentIdentityProvider identityProvider;
  private final StoreLevelPricingDirectory storeLevelDirectory;

  public AccessoryMarkupConfigurationService(AccessoryMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      StoreLevelPricingDirectory storeLevelDirectory, AccessoryPriceConfigurationSyncService priceSyncService) {
    this.mapper = mapper;
    this.priceSyncService = priceSyncService;
    this.identityProvider = identityProvider;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  public List<AccessoryMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<AccessoryMarkupConfiguration>lambdaQuery();
    query.ne(AccessoryMarkupConfiguration::getName, "指导价")
        .eq(AccessoryMarkupConfiguration::getLegacySeeded, false);
    if (enabledOnly) {
      query.eq(AccessoryMarkupConfiguration::getStatus, "enabled");
    }
    List<AccessoryMarkupConfiguration> result = mapper.selectList(query
        .orderByAsc(AccessoryMarkupConfiguration::getSortOrder)
        .orderByDesc(AccessoryMarkupConfiguration::getCreatedAt)
        .orderByDesc(AccessoryMarkupConfiguration::getId));
    result = com.zdm.platform.security.DataScope.filter(identityProvider.require(), result);
    creatorNames.attachAll(result);
    result.forEach(this::enrich);
    return result;
  }

  @Transactional
  public AccessoryMarkupConfiguration createConfiguration(AccessoryMarkupConfiguration payload) {
    CurrentIdentity identity = requirePlatformScope();
    StoreLevelPricingDirectory.Level level = storeLevelDirectory.requireOperationalPricingLevel(payload.getStoreLevelId());
    payload.setId(null);
    payload.setName(level.name());
    payload.setStatus("enabled");
    payload.setSortOrder(nextSortOrder());
    payload.setCreatedByAccountId(identity.accountId());
    validateUniqueStoreLevel(payload.getStoreLevelId(), null);
    try {
      mapper.insert(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE, exception);
    }
    AccessoryMarkupConfiguration created = requireConfiguration(payload.getId());
    priceSyncService.backfillMissingPrices(created);
    return created;
  }

  @Transactional
  public AccessoryMarkupConfiguration updateConfiguration(Long id, AccessoryMarkupConfiguration payload) {
    requirePlatformScope();
    AccessoryMarkupConfiguration existing = requireConfiguration(id);
    payload.setId(id);
    payload.setStoreLevelId(existing.getStoreLevelId());
    payload.setName(existing.getName());
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueStoreLevel(payload.getStoreLevelId(), id);
    try { mapper.updateById(payload); } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE, exception);
    }
    AccessoryMarkupConfiguration updated = requireConfiguration(id);
    priceSyncService.refreshAutoPrices(updated);
    return updated;
  }

  @Transactional
  public List<AccessoryMarkupConfiguration> reorderConfigurations(List<Long> orderedIds) {
    requirePlatformScope();
    List<AccessoryMarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<AccessoryMarkupConfiguration>lambdaQuery()
            .eq(AccessoryMarkupConfiguration::getLegacySeeded, false));
    configurations = com.zdm.platform.security.DataScope.filter(identityProvider.require(), configurations);
    if (orderedIds == null || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交当前全部配件价格配置");
    }
    Map<Long, AccessoryMarkupConfiguration> configurationsById = configurations.stream()
        .collect(Collectors.toMap(AccessoryMarkupConfiguration::getId, Function.identity()));
    if (!configurationsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("配件价格配置顺序与当前数据不一致");
    }
    for (int index = 0; index < orderedIds.size(); index += 1) {
      AccessoryMarkupConfiguration configuration = configurationsById.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(false);
  }

  @Transactional
  public AccessoryMarkupConfiguration updateStatus(Long id, String status) {
    requirePlatformScope();
    if (!List.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("价格配置状态不正确");
    }
    AccessoryMarkupConfiguration existing = requireConfiguration(id);
    existing.setStatus(status);
    mapper.updateById(existing);
    priceSyncService.refreshAutoPrices(existing);
    priceSyncService.backfillMissingPrices(existing);
    return requireConfiguration(id);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    requireConfiguration(id);
    if (priceSyncService.countAutoReferences(id) > 0) {
      throw new IllegalArgumentException("该价格配置正在被配件价格使用，不能删除，请先停用");
    }
    mapper.deleteById(id);
  }

  public AccessoryMarkupConfiguration requireConfiguration(Long id) {
    AccessoryMarkupConfiguration configuration = mapper.selectById(id);
    if (configuration == null) {
      throw new IllegalArgumentException("配件价格层级不存在");
    }
    com.zdm.platform.security.DataScope.requireAccess(identityProvider.require(), configuration.getCreatedByAccountId());
    enrich(configuration);
    return creatorNames.attach(configuration);
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护配件价格层级");
    }
    return identity;
  }

  private void validateUniqueStoreLevel(Long storeLevelId, Long excludedId) {
    var query = Wrappers.<AccessoryMarkupConfiguration>lambdaQuery()
        .eq(AccessoryMarkupConfiguration::getStoreLevelId, storeLevelId);
    if (excludedId != null) {
      query.ne(AccessoryMarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE);
    }
  }

  private void enrich(AccessoryMarkupConfiguration configuration) {
    StoreLevelPricingDirectory.Level level = storeLevelDirectory.findLevel(configuration.getStoreLevelId());
    if (level == null) {
      throw new IllegalStateException("配件价格配置关联的门店级别不存在");
    }
    configuration.setName(level.name());
  }

  private int nextSortOrder() {
    AccessoryMarkupConfiguration lastConfiguration = mapper.selectOne(
        Wrappers.<AccessoryMarkupConfiguration>lambdaQuery()
            .eq(AccessoryMarkupConfiguration::getLegacySeeded, false)
            .orderByDesc(AccessoryMarkupConfiguration::getSortOrder)
            .last("LIMIT 1"));
    return lastConfiguration == null || lastConfiguration.getSortOrder() == null
        ? 1
        : lastConfiguration.getSortOrder() + 1;
  }
}
