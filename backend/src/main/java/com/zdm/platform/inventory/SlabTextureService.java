package com.zdm.platform.inventory;

import com.baomidou.mybatisplus.core.toolkit.Wrappers;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.util.List;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

@Service
public class SlabTextureService extends ServiceImpl<SlabTextureMapper, SlabTexture> {
  private static final String DEFAULT_CREATED_BY_NAME = "韩健";
  private final SlabTextureAliasMapper aliasMapper;
  private final CurrentIdentityProvider identityProvider;

  public SlabTextureService(
      SlabTextureAliasMapper aliasMapper,
      CurrentIdentityProvider identityProvider) {
    this.aliasMapper = aliasMapper;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public SlabTexture createTexture(SlabTexture texture) {
    texture.setId(null);
    normalizeAndValidateTextureName(texture, null);
    texture.setCreatedByName(resolveCreatedByName());
    texture.setCreatedByAccountId(identityProvider.require().accountId());
    save(texture);
    return texture;
  }

  @Transactional
  public SlabTexture updateTexture(Long id, SlabTexture payload) {
    SlabTexture existing = requireTexture(id);
    payload.setId(id);
    payload.setStatus(existing.getStatus());
    payload.setCreatedByName(existing.getCreatedByName());
    payload.setCreatedByAccountId(existing.getCreatedByAccountId());
    normalizeAndValidateTextureName(payload, id);
    updateById(payload);
    return getById(id);
  }

  @Transactional
  public SlabTexture updateStatus(Long id, String status) {
    SlabTexture existing = requireTexture(id);
    existing.setStatus(status);
    updateById(existing);
    return getById(id);
  }

  @Transactional
  public boolean deleteTexture(Long id) {
    requireTexture(id);
    return removeById(id);
  }

  public List<SlabTextureAlias> listAliases(Long textureId) {
    requireTexture(textureId);
    return aliasMapper.selectList(Wrappers.<SlabTextureAlias>lambdaQuery()
        .eq(SlabTextureAlias::getTextureId, textureId)
        .orderByDesc(SlabTextureAlias::getCreatedAt));
  }

  @Transactional
  public SlabTextureAlias createAlias(Long textureId, SlabTextureAlias alias) {
    requireTexture(textureId);
    alias.setId(null);
    alias.setTextureId(textureId);
    alias.setStatus("enabled");
    normalizeAndValidateAliasName(alias, null);
    aliasMapper.insert(alias);
    return alias;
  }

  @Transactional
  public SlabTextureAlias updateAlias(Long textureId, Long aliasId, SlabTextureAlias payload) {
    requireTexture(textureId);
    SlabTextureAlias existing = requireAlias(textureId, aliasId);
    payload.setId(aliasId);
    payload.setTextureId(textureId);
    payload.setStatus(existing.getStatus());
    normalizeAndValidateAliasName(payload, aliasId);
    aliasMapper.updateById(payload);
    return aliasMapper.selectById(aliasId);
  }

  @Transactional
  public boolean deleteAlias(Long textureId, Long aliasId) {
    requireTexture(textureId);
    requireAlias(textureId, aliasId);
    return aliasMapper.deleteById(aliasId) > 0;
  }

  private SlabTexture requireTexture(Long id) {
    SlabTexture texture = getById(id);
    if (texture == null) {
      throw new IllegalArgumentException("纹理不存在");
    }
    return texture;
  }

  private SlabTextureAlias requireAlias(Long textureId, Long aliasId) {
    SlabTextureAlias alias = aliasMapper.selectById(aliasId);
    if (alias == null || !Objects.equals(alias.getTextureId(), textureId)) {
      throw new IllegalArgumentException("纹理别名不存在");
    }
    return alias;
  }

  private void normalizeAndValidateTextureName(SlabTexture texture, Long excludedId) {
    String name = texture.getName().trim();
    texture.setName(name);
    var query = lambdaQuery().eq(SlabTexture::getName, name);
    if (excludedId != null) {
      query.ne(SlabTexture::getId, excludedId);
    }
    if (query.count() > 0 || aliasMapper.selectCount(
        Wrappers.<SlabTextureAlias>lambdaQuery().eq(SlabTextureAlias::getName, name)) > 0) {
      throw new IllegalArgumentException("纹理名称已存在");
    }
  }

  private void normalizeAndValidateAliasName(SlabTextureAlias alias, Long excludedId) {
    String name = alias.getName().trim();
    alias.setName(name);
    var query = Wrappers.<SlabTextureAlias>lambdaQuery().eq(SlabTextureAlias::getName, name);
    if (excludedId != null) {
      query.ne(SlabTextureAlias::getId, excludedId);
    }
    if (aliasMapper.selectCount(query) > 0 || lambdaQuery().eq(SlabTexture::getName, name).count() > 0) {
      throw new IllegalArgumentException("别名已存在或与标准纹理重复");
    }
  }

  private String resolveCreatedByName() {
    CurrentIdentity identity = identityProvider.current().orElse(null);
    return identity != null && StringUtils.hasText(identity.displayName())
        ? identity.displayName() : DEFAULT_CREATED_BY_NAME;
  }

}
