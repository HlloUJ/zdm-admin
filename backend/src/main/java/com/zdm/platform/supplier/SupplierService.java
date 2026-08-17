package com.zdm.platform.supplier;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import com.zdm.platform.security.CreatorOwnershipGuard;
import java.util.List;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SupplierService extends ServiceImpl<SupplierMapper, Supplier> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private static final String DUPLICATE_NAME_MESSAGE = "供应商名称已存在";
  private static final String SLAB_REFERENCED_MESSAGE =
      "该供应商已关联大板库存，不能删除，请先停用该供应商";
  private static final String FINISHED_REFERENCED_MESSAGE =
      "该供应商已关联成品，不能删除，请先停用该供应商";
  private static final String REFERENCED_MESSAGE =
      "该供应商已关联大板库存或成品，不能删除，请先停用该供应商";

  private final JdbcTemplate jdbcTemplate;
  private final CurrentIdentityProvider identityProvider;
  private final CreatorOwnershipGuard ownershipGuard;

  public SupplierService(
      JdbcTemplate jdbcTemplate,
      CurrentIdentityProvider identityProvider,
      CreatorOwnershipGuard ownershipGuard) {
    this.jdbcTemplate = jdbcTemplate;
    this.identityProvider = identityProvider;
    this.ownershipGuard = ownershipGuard;
  }

  public List<Supplier> listSuppliers() {
    return lambdaQuery()
        .orderByDesc(Supplier::getCreatedAt)
        .orderByDesc(Supplier::getId)
        .list();
  }

  @Transactional
  public Supplier createSupplier(Supplier supplier) {
    supplier.setId(null);
    normalizeAndValidateName(supplier, null);
    supplier.setCreatedByName(resolveCreatedByName());
    supplier.setCreatedByAccountId(ownershipGuard.currentAccountId());
    try {
      save(supplier);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return supplier;
  }

  @Transactional
  public Supplier updateSupplier(Long id, Supplier payload) {
    Supplier existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    payload.setId(id);
    normalizeAndValidateName(payload, id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    try {
      updateById(payload);
    } catch (DuplicateKeyException exception) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE, exception);
    }
    return getById(id);
  }

  @Transactional
  public Supplier updateStatus(Long id, String status) {
    Supplier existing = getById(id);
    if (existing == null) {
      return null;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteSupplier(Long id) {
    Supplier existing = getById(id);
    if (existing == null) {
      return false;
    }
    ownershipGuard.requireCreator(existing.getCreatedByAccountId(), existing.getCreatedByName());

    Long slabInventoryReferenceCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM slab_inventory WHERE supplier_id = ?",
        Long.class,
        id);
    Long finishedProductReferenceCount = jdbcTemplate.queryForObject(
        "SELECT COUNT(*) FROM finished_products WHERE supplier_id = ?",
        Long.class,
        id);
    boolean referencedBySlabInventory =
        slabInventoryReferenceCount != null && slabInventoryReferenceCount > 0;
    boolean referencedByFinishedProduct =
        finishedProductReferenceCount != null && finishedProductReferenceCount > 0;
    if (referencedBySlabInventory && referencedByFinishedProduct) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE);
    }
    if (referencedBySlabInventory) {
      throw new IllegalArgumentException(SLAB_REFERENCED_MESSAGE);
    }
    if (referencedByFinishedProduct) {
      throw new IllegalArgumentException(FINISHED_REFERENCED_MESSAGE);
    }

    try {
      return removeById(id);
    } catch (DataIntegrityViolationException exception) {
      throw new IllegalArgumentException(REFERENCED_MESSAGE, exception);
    }
  }

  private String resolveCreatedByName() {
    return identityProvider.current()
        .map(CurrentIdentity::displayName)
        .filter(StringUtils::hasText)
        .orElse(DEFAULT_CREATED_BY_NAME);
  }

  private void normalizeAndValidateName(Supplier supplier, Long excludedSupplierId) {
    String supplierName = supplier.getName().trim();
    supplier.setName(supplierName);
    var duplicateQuery = lambdaQuery().eq(Supplier::getName, supplierName);
    if (excludedSupplierId != null) {
      duplicateQuery.ne(Supplier::getId, excludedSupplierId);
    }
    if (duplicateQuery.count() > 0) {
      throw new IllegalArgumentException(DUPLICATE_NAME_MESSAGE);
    }
  }
}
