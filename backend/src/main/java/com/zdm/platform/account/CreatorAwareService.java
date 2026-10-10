package com.zdm.platform.account;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.baomidou.mybatisplus.extension.conditions.query.LambdaQueryChainWrapper;
import com.baomidou.mybatisplus.extension.service.impl.ServiceImpl;
import java.io.Serializable;
import java.util.Collection;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;

/** Opt-in base for the explicitly audited business entities; no SQL interception or global hooks. */
public class CreatorAwareService<M extends BaseMapper<T>, T extends NamedCreatorOwned> extends ServiceImpl<M, T> {
  @Autowired
  protected CreatorNames creatorNames;

  @Override
  public T getById(Serializable id) { return creatorNames.attach(super.getById(id)); }

  @Override
  public List<T> list(Wrapper<T> query) { return creatorNames.attachAll(super.list(query)); }

  @Override
  public List<T> listByIds(Collection<? extends Serializable> ids) {
    return creatorNames.attachAll(super.listByIds(ids));
  }

  @Override
  public boolean save(T entity) {
    boolean saved = super.save(entity);
    if (saved) { creatorNames.attach(entity); }
    return saved;
  }

  @Override
  public LambdaQueryChainWrapper<T> lambdaQuery() {
    return new LambdaQueryChainWrapper<T>(getBaseMapper()) {
      @Override
      public List<T> list() { return creatorNames.attachAll(super.list()); }
      @Override
      public T one() { return creatorNames.attach(super.one()); }
    };
  }
}
