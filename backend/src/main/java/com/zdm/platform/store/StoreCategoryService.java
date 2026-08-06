package com.zdm.platform.store;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class StoreCategoryService extends ServiceImpl<StoreCategoryMapper, StoreCategory> {
  private static final String DUPLICATE_NAME_MESSAGE = "同级分类名称不能重复";

  private final CurrentIdentityProvider identityProvider;

  public StoreCategoryService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  // 门店分类属于门店：同一门店内共享，不按创建人过滤，不得跨门店读写。
  public List<StoreCategory> listOrdered() {
    Long storeId = requireStoreId();
    return lambdaQuery()
        .eq(StoreCategory::getStoreId, storeId)
        .orderByAsc(StoreCategory::getSortOrder)
        .orderByDesc(StoreCategory::getCreatedAt)
        .orderByDesc(StoreCategory::getId)
        .list();
  }

  @Transactional
  public StoreCategory createCategory(StoreCategoryCreateRequest request) {
    Long storeId = requireStoreId();
    StoreCategory category = new StoreCategory();
    category.setStoreId(storeId);
    category.setParentId(request.parentId());
    category.setName(request.name().trim());
    category.setStatus(request.status());
    category.setProductCount(0);
    category.setCreatedByName(identityProvider.require().displayName());
    validateParent(category.getParentId());
    requireUniqueName(category.getParentId(), category.getName(), null);
    makeRoomForNewest(category.getParentId());
    category.setSortOrder(1);
    try {
      save(category);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireCategory(category.getId());
  }

  @Transactional
  public StoreCategory updateCategory(Long id, StoreCategoryUpdateRequest request) {
    StoreCategory category = requireCategory(id);
    String name = request.name().trim();
    requireUniqueName(category.getParentId(), name, id);
    category.setName(name);
    try {
      updateById(category);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return requireCategory(id);
  }

  @Transactional
  public StoreCategory updateStatus(Long id, String status) {
    StoreCategory category = requireCategory(id);
    category.setStatus(status);
    updateById(category);
    List<Long> descendantIds = descendantIds(id);
    if (!descendantIds.isEmpty()) {
      update(Wrappers.<StoreCategory>lambdaUpdate()
          .in(StoreCategory::getId, descendantIds)
          .set(StoreCategory::getStatus, status));
    }
    return requireCategory(id);
  }

  @Transactional
  public StoreCategory moveCategory(Long id, String direction) {
    StoreCategory category = requireCategory(id);
    List<StoreCategory> siblings = listSiblings(category.getParentId());
    int currentIndex = -1;
    for (int index = 0; index < siblings.size(); index += 1) {
      if (siblings.get(index).getId().equals(id)) {
        currentIndex = index;
        break;
      }
    }
    int targetIndex = currentIndex + ("up".equals(direction) ? -1 : 1);
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= siblings.size()) {
      return category;
    }
    StoreCategory target = siblings.get(targetIndex);
    Integer currentSortOrder = category.getSortOrder();
    category.setSortOrder(target.getSortOrder());
    target.setSortOrder(currentSortOrder);
    updateById(category);
    updateById(target);
    return requireCategory(id);
  }

  @Transactional
  public void deleteCategory(Long id) {
    StoreCategory category = requireCategory(id);
    if (lambdaQuery()
        .eq(StoreCategory::getStoreId, category.getStoreId())
        .eq(StoreCategory::getParentId, id)
        .count() > 0) {
      throw new IllegalArgumentException("该分类包含下级分类，请先删除或转移下级分类");
    }
    if (category.getProductCount() != null && category.getProductCount() > 0) {
      throw new IllegalArgumentException("该分类已关联商品，不能删除，请先停用该分类");
    }
    Long parentId = category.getParentId();
    if (!removeById(id)) {
      throw new IllegalArgumentException("分类删除失败，请刷新后重试");
    }
    normalizeSortOrder(parentId);
  }

  private StoreCategory requireCategory(Long id) {
    StoreCategory category = lambdaQuery()
        .eq(StoreCategory::getId, id)
        .eq(StoreCategory::getStoreId, requireStoreId())
        .one();
    if (category == null) {
      throw new IllegalArgumentException("分类不存在或已被删除");
    }
    return category;
  }

  private void validateParent(Long parentId) {
    if (parentId == null) {
      return;
    }
    StoreCategory parent = requireCategory(parentId);
    if (parent.getParentId() != null && requireCategory(parent.getParentId()).getParentId() != null) {
      throw new IllegalArgumentException("门店分类最多支持三级");
    }
  }

  private List<Long> descendantIds(Long id) {
    Long storeId = requireStoreId();
    List<StoreCategory> categories = lambdaQuery()
        .select(StoreCategory::getId, StoreCategory::getParentId)
        .eq(StoreCategory::getStoreId, storeId)
        .list();
    Set<Long> familyIds = new HashSet<>();
    familyIds.add(id);
    List<Long> descendantIds = new ArrayList<>();
    boolean foundNewDescendant;
    do {
      foundNewDescendant = false;
      for (StoreCategory category : categories) {
        if (category.getParentId() != null
            && familyIds.contains(category.getParentId())
            && familyIds.add(category.getId())) {
          descendantIds.add(category.getId());
          foundNewDescendant = true;
        }
      }
    } while (foundNewDescendant);
    return descendantIds;
  }

  private void requireUniqueName(Long parentId, String name, Long excludedId) {
    var query = lambdaQuery()
        .eq(StoreCategory::getStoreId, requireStoreId())
        .eq(StoreCategory::getName, name);
    if (parentId == null) {
      query.isNull(StoreCategory::getParentId);
    } else {
      query.eq(StoreCategory::getParentId, parentId);
    }
    if (excludedId != null) {
      query.ne(StoreCategory::getId, excludedId);
    }
    if (query.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }

  private void makeRoomForNewest(Long parentId) {
    var updateWrapper = Wrappers.<StoreCategory>lambdaUpdate()
        .eq(StoreCategory::getStoreId, requireStoreId());
    if (parentId == null) {
      updateWrapper.isNull(StoreCategory::getParentId);
    } else {
      updateWrapper.eq(StoreCategory::getParentId, parentId);
    }
    updateWrapper.setSql("sort_order = sort_order + 1");
    update(updateWrapper);
  }

  private List<StoreCategory> listSiblings(Long parentId) {
    var query = lambdaQuery().eq(StoreCategory::getStoreId, requireStoreId());
    if (parentId == null) {
      query.isNull(StoreCategory::getParentId);
    } else {
      query.eq(StoreCategory::getParentId, parentId);
    }
    return query.orderByAsc(StoreCategory::getSortOrder).orderByAsc(StoreCategory::getId).list();
  }

  private void normalizeSortOrder(Long parentId) {
    List<StoreCategory> siblings = listSiblings(parentId);
    for (int index = 0; index < siblings.size(); index += 1) {
      StoreCategory sibling = siblings.get(index);
      sibling.setSortOrder(index + 1);
      updateById(sibling);
    }
  }

  private Long requireStoreId() {
    CurrentIdentity identity = identityProvider.require();
    if (identity.storeId() == null) {
      throw new AccessDeniedException("当前身份未关联门店");
    }
    return identity.storeId();
  }
}
