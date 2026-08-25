package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SlabGradeService extends ServiceImpl<SlabGradeMapper, SlabGrade> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";

  private final CurrentIdentityProvider identityProvider;
  public SlabGradeService(CurrentIdentityProvider identityProvider) {
    this.identityProvider = identityProvider;
  }

  @Transactional
  public SlabGrade createGrade(SlabGrade grade) {
    grade.setId(null);
    normalizeAndValidate(grade, null);
    grade.setCreatedByName(resolveCreatedByName());
    grade.setCreatedByAccountId(identityProvider.require().accountId());
    save(grade);
    return grade;
  }

  @Transactional
  public SlabGrade updateGrade(Long id, SlabGrade payload) {
    SlabGrade existing = getById(id);
    if (existing == null) {
      return null;
    }
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidate(payload, id);
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public SlabGrade updateStatus(Long id, String status) {
    SlabGrade existing = getById(id);
    if (existing == null) {
      return null;
    }
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteGrade(Long id) {
    SlabGrade existing = getById(id);
    if (existing == null) {
      return false;
    }
    return removeById(id);
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName()
        : DEFAULT_CREATED_BY_NAME;
  }

  private void normalizeAndValidate(SlabGrade grade, Long excludedId) {
    String code = grade.getCode().trim();
    String name = grade.getName().trim();
    grade.setCode(code);
    grade.setName(name);

    var duplicateCode = lambdaQuery().eq(SlabGrade::getCode, code);
    var duplicateName = lambdaQuery().eq(SlabGrade::getName, name);
    if (excludedId != null) {
      duplicateCode.ne(SlabGrade::getId, excludedId);
      duplicateName.ne(SlabGrade::getId, excludedId);
    }
    if (duplicateCode.count() > 0) {
      throw new IllegalArgumentException("等级已存在");
    }
    if (duplicateName.count() > 0) {
      throw new IllegalArgumentException("等级名称已存在");
    }
  }
}
