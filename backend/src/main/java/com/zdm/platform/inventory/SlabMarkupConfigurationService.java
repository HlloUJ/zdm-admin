package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
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

  public SlabMarkupConfigurationService(
      SlabMarkupConfigurationMapper mapper,
      CurrentIdentityProvider identityProvider,
      StoreLevelPricingDirectory storeLevelDirectory) {
    this.mapper = mapper;
    this.identityProvider = identityProvider;
    this.storeLevelDirectory = storeLevelDirectory;
  }

  public List<SlabMarkupConfiguration> listConfigurations(boolean enabledOnly) {
    requirePlatformScope();
    var query = Wrappers.<SlabMarkupConfiguration>lambdaQuery();
    query.ne(SlabMarkupConfiguration::getName, "指导价")
        .eq(SlabMarkupConfiguration::getLegacySeeded, false);
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
    payload.setSortOrder(level.sortOrder());
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
    return requireConfiguration(id);
  }

  @Transactional
  public void deleteConfiguration(Long id) {
    requirePlatformScope();
    requireConfiguration(id);
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
    configuration.setSortOrder(level.sortOrder());
  }
}
