package com.zdm.platform.store;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.common.StoreLevelPricingDirectory;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class StoreLevelService extends ServiceImpl<StoreLevelMapper, StoreLevel>
    implements StoreLevelPricingDirectory {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String STORE_REFERENCED_MESSAGE = "该门店级别已被门店引用，不能删除";
  private static final String PRICE_REFERENCED_MESSAGE = "该门店级别已被价格配置引用，不能删除";
  private static final String PRODUCT_PRICE_REFERENCED_MESSAGE = "该门店级别已被商品价格引用，不能删除";

  private final StoreMapper storeMapper;
  private final CurrentIdentityProvider identityProvider;
  private final JdbcTemplate jdbcTemplate;

  public StoreLevelService(
      StoreMapper storeMapper,
      CurrentIdentityProvider identityProvider,
      JdbcTemplate jdbcTemplate) {
    this.storeMapper = storeMapper;
    this.identityProvider = identityProvider;
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<StoreLevel> listEnabled() {
    return enrich(lambdaQuery().eq(StoreLevel::getStatus, "enabled")
        .orderByAsc(StoreLevel::getSortOrder).orderByAsc(StoreLevel::getId).list());
  }

  public List<StoreLevel> listLevels() {
    return enrich(lambdaQuery().orderByAsc(StoreLevel::getSortOrder)
        .orderByAsc(StoreLevel::getId).list());
  }

  @Transactional
  public StoreLevel createLevel(StoreLevel level) {
    level.setId(null);
    normalizeAndValidate(level, null);
    level.setStatus("enabled");
    level.setSortOrder(nextSortOrder());
    level.setCreatedByName(resolveCreatedByName());
    level.setCreatedByAccountId(identityProvider.require().accountId());
    save(level);
    return level;
  }

  @Transactional
  public StoreLevel updateLevel(Long id, StoreLevel payload) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return null;
    }
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setSortOrder(existing.getSortOrder());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidate(payload, id);
    updateById(payload);
    jdbcTemplate.update(
        "UPDATE finished_markup_configurations SET name = ? WHERE store_level_id = ?",
        payload.getName(),
        id);
    jdbcTemplate.update(
        "UPDATE slab_markup_configurations SET name = ? WHERE store_level_id = ?",
        payload.getName(),
        id);
    return getById(id);
  }

  @Transactional
  public StoreLevel updateStatus(Long id, String status) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return null;
    }
    if ("disabled".equals(status)) {
      requireNoStoreReferences(id);
    }
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public List<StoreLevel> reorderLevels(List<Long> orderedIds) {
    List<StoreLevel> levels = listLevels();
    if (orderedIds == null || orderedIds.size() != levels.size()
        || new HashSet<>(orderedIds).size() != levels.size()) {
      throw new IllegalArgumentException("请提交全部门店级别");
    }
    Map<Long, StoreLevel> levelsById = levels.stream()
        .collect(Collectors.toMap(StoreLevel::getId, Function.identity()));
    if (!levelsById.keySet().equals(new HashSet<>(orderedIds))) {
      throw new IllegalArgumentException("门店级别顺序与当前数据不一致");
    }
    for (int index = 0; index < orderedIds.size(); index += 1) {
      StoreLevel level = levelsById.get(orderedIds.get(index));
      level.setSortOrder(index + 1);
      updateById(level);
      jdbcTemplate.update(
          "UPDATE finished_markup_configurations SET sort_order = ? WHERE store_level_id = ?",
          index + 1,
          level.getId());
      jdbcTemplate.update(
          "UPDATE slab_markup_configurations SET sort_order = ? WHERE store_level_id = ?",
          index + 1,
          level.getId());
    }
    return listLevels();
  }

  @Transactional
  public boolean deleteLevel(Long id) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      return false;
    }
    requireUnreferenced(id);
    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException("该门店级别仍被业务数据引用，不能删除", exception);
    }
  }

  public boolean previewDelete(Long id) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("门店级别不存在");
    }
    requireUnreferenced(id);
    return true;
  }

  public boolean previewDisable(Long id) {
    StoreLevel existing = getById(id);
    if (existing == null) {
      throw new IllegalArgumentException("门店级别不存在");
    }
    requireNoStoreReferences(id);
    return true;
  }

  public StoreLevel requireEnabled(Long id) {
    StoreLevel level = id == null ? null : getById(id);
    if (level == null) {
      throw new IllegalArgumentException("门店级别不存在");
    }
    if (!"enabled".equals(level.getStatus())) {
      throw new IllegalArgumentException("门店级别已停用");
    }
    return level;
  }

  @Override
  public StoreLevelPricingDirectory.Level requireEnabledLevel(Long id) {
    return toPricingLevel(requireEnabled(id));
  }

  @Override
  public StoreLevelPricingDirectory.Level findLevel(Long id) {
    StoreLevel level = id == null ? null : getById(id);
    return level == null ? null : toPricingLevel(level);
  }

  @Override
  public List<StoreLevelPricingDirectory.Level> listEnabledLevels() {
    return listEnabled().stream().map(this::toPricingLevel).toList();
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }

  private void requireUnreferenced(Long id) {
    Long referenceCount = storeMapper.selectCount(
        Wrappers.<Store>lambdaQuery().eq(Store::getStoreLevelId, id));
    if (referenceCount > 0) {
      throw new IllegalArgumentException(STORE_REFERENCED_MESSAGE);
    }
    if (isPriceConfigured("finished_markup_configurations", id)
        || isPriceConfigured("slab_markup_configurations", id)) {
      throw new IllegalArgumentException(PRICE_REFERENCED_MESSAGE);
    }
    if (isPriceConfigured("finished_product_prices", id)
        || isPriceConfigured("slab_prices", id)) {
      throw new IllegalArgumentException(PRODUCT_PRICE_REFERENCED_MESSAGE);
    }
  }

  private void requireNoStoreReferences(Long id) {
    Long storeCount = storeMapper.selectCount(
        Wrappers.<Store>lambdaQuery().eq(Store::getStoreLevelId, id));
    if (storeCount > 0) {
      throw new IllegalArgumentException("该门店级别仍有门店使用，不能停用，请先调整相关门店的级别");
    }
  }

  private int nextSortOrder() {
    StoreLevel last = lambdaQuery().orderByDesc(StoreLevel::getSortOrder).last("LIMIT 1").one();
    return last == null || last.getSortOrder() == null ? 1 : last.getSortOrder() + 1;
  }

  private boolean isPriceConfigured(String table, Long levelId) {
    Integer count = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM " + table + " WHERE store_level_id = ?",
        Integer.class,
        levelId);
    return count != null && count > 0;
  }

  private List<StoreLevel> enrich(List<StoreLevel> levels) {
    levels.forEach(level -> {
      boolean finished = isPriceConfigured("finished_markup_configurations", level.getId());
      boolean slab = isPriceConfigured("slab_markup_configurations", level.getId());
      level.setFinishedPriceConfigured(finished);
      level.setSlabPriceConfigured(slab);
      level.setPriceComplete(finished && slab);
    });
    return levels;
  }

  private StoreLevelPricingDirectory.Level toPricingLevel(StoreLevel level) {
    return new StoreLevelPricingDirectory.Level(level.getId(), level.getName(), level.getSortOrder());
  }

  private void normalizeAndValidate(StoreLevel level, Long excludedId) {
    String name = level.getName().trim();
    level.setName(name);

    var duplicateName = lambdaQuery().eq(StoreLevel::getName, name);
    if (excludedId != null) {
      duplicateName.ne(StoreLevel::getId, excludedId);
    }
    if (duplicateName.count() > 0) {
      throw new IllegalArgumentException("级别名称已存在");
    }
  }
}
