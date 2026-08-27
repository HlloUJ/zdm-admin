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
public class FinishedMarkupConfigurationService {
  private static final String DUPLICATE_LEVEL_MESSAGE = "该门店级别已配置成品价格";
  private final FinishedMarkupConfigurationMapper mapper;
  private final CurrentIdentityProvider identityProvider;
  private final StoreLevelPricingDirectory storeLevelDirectory;

  public FinishedMarkupConfigurationService(FinishedMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      StoreLevelPricingDirectory storeLevelDirectory) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  public List<FinishedMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<FinishedMarkupConfiguration>lambdaQuery();
    query.ne(FinishedMarkupConfiguration::getName, "指导价")
        .eq(FinishedMarkupConfiguration::getLegacySeeded, false);
    if (enabledOnly) {
      query.eq(FinishedMarkupConfiguration::getStatus, "enabled");
    }
    List<FinishedMarkupConfiguration> result = mapper.selectList(query
        .orderByAsc(FinishedMarkupConfiguration::getSortOrder)
        .orderByDesc(FinishedMarkupConfiguration::getCreatedAt)
        .orderByDesc(FinishedMarkupConfiguration::getId));
    result.forEach(this::enrich);
    return result;
  }

  @Transactional
  public FinishedMarkupConfiguration createConfiguration(FinishedMarkupConfiguration payload) {
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
    return requireConfiguration(payload.getId());
  }

  @Transactional
  public FinishedMarkupConfiguration updateConfiguration(Long id, FinishedMarkupConfiguration payload) {
    requirePlatformScope();
    FinishedMarkupConfiguration existing = requireConfiguration(id);
    payload.setId(id);
    payload.setStoreLevelId(existing.getStoreLevelId());
    payload.setName(existing.getName());
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    validateUniqueStoreLevel(payload.getStoreLevelId(), id);
    try { mapper.updateById(payload); } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE, exception);
    }
    return requireConfiguration(id);
  }

  @Transactional
  public List<FinishedMarkupConfiguration> reorderConfigurations(List<Long> orderedIds) {
    requirePlatformScope();
    List<FinishedMarkupConfiguration> configurations = mapper.selectList(
        Wrappers.<FinishedMarkupConfiguration>lambdaQuery()
            .eq(FinishedMarkupConfiguration::getLegacySeeded, false));
    if (orderedIds == null || orderedIds.size() != configurations.size()
        || new HashSet<>(orderedIds).size() != configurations.size()) {
      throw new IllegalArgumentException("请提交当前全部成品价格配置");
    }
    Map<Long, FinishedMarkupConfiguration> configurationsById = configurations.stream()
        .collect(Collectors.toMap(FinishedMarkupConfiguration::getId, Function.identity()));
    if (!configurationsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("成品价格配置顺序与当前数据不一致");
    }
    for (int index = 0; index < orderedIds.size(); index += 1) {
      FinishedMarkupConfiguration configuration = configurationsById.get(orderedIds.get(index));
      configuration.setSortOrder(index + 1);
      mapper.updateById(configuration);
    }
    return listConfigurations(false);
  }

  @Transactional
  public FinishedMarkupConfiguration updateStatus(Long id, String status) {
    requirePlatformScope();
    if (!List.of("enabled", "disabled").contains(status)) {
      throw new IllegalArgumentException("价格配置状态不正确");
    }
    FinishedMarkupConfiguration existing = requireConfiguration(id);
    existing.setStatus(status);
    mapper.updateById(existing);
    return requireConfiguration(id);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    requireConfiguration(id);
    mapper.deleteById(id);
  }

  public FinishedMarkupConfiguration requireConfiguration(Long id) {
    FinishedMarkupConfiguration configuration = mapper.selectById(id);
    if (configuration == null) {
      throw new IllegalArgumentException("成品现货价格层级不存在");
    }
    enrich(configuration);
    return configuration;
  }

  private CurrentIdentity requirePlatformScope() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.tenantId() != null || identity.storeId() != null) {
      throw new AccessDeniedException("仅运营管理平台可以维护成品现货价格层级");
    }
    return identity;
  }

  private void validateUniqueStoreLevel(Long storeLevelId, Long excludedId) {
    var query = Wrappers.<FinishedMarkupConfiguration>lambdaQuery()
        .eq(FinishedMarkupConfiguration::getStoreLevelId, storeLevelId);
    if (excludedId != null) {
      query.ne(FinishedMarkupConfiguration::getId, excludedId);
    }
    if (mapper.selectCount(query) > 0) {
      throw new IllegalArgumentException(DUPLICATE_LEVEL_MESSAGE);
    }
  }

  private void enrich(FinishedMarkupConfiguration configuration) {
    StoreLevelPricingDirectory.Level level = storeLevelDirectory.findLevel(configuration.getStoreLevelId());
    if (level == null) {
      throw new IllegalStateException("成品价格配置关联的门店级别不存在");
    }
    configuration.setName(level.name());
  }

  private int nextSortOrder() {
    FinishedMarkupConfiguration lastConfiguration = mapper.selectOne(
        Wrappers.<FinishedMarkupConfiguration>lambdaQuery()
            .eq(FinishedMarkupConfiguration::getLegacySeeded, false)
            .orderByDesc(FinishedMarkupConfiguration::getSortOrder)
            .last("LIMIT 1"));
    return lastConfiguration == null || lastConfiguration.getSortOrder() == null
        ? 1
        : lastConfiguration.getSortOrder() + 1;
  }
}
