package com.zdm.platform.media;

import com.zdm.platform.security.CurrentIdentity;
import com.zdm.platform.security.CurrentIdentityProvider;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class MediaReferenceService {
  private final MediaAssetService assetService;
  private final MediaCleanupService cleanupService;
  private final MediaReferenceMapper referenceMapper;
  private final CurrentIdentityProvider identityProvider;

  public MediaReferenceService(
      MediaAssetService assetService,
      MediaCleanupService cleanupService,
      MediaReferenceMapper referenceMapper,
      CurrentIdentityProvider identityProvider) {
    this.assetService = assetService;
    this.cleanupService = cleanupService;
    this.referenceMapper = referenceMapper;
    this.identityProvider = identityProvider;
  }

  @Transactional
  public void replace(String domain, Long businessId, Map<String, Long> requested) {
    CurrentIdentity identity = identityProvider.require();
    Map<String, Long> desired = new LinkedHashMap<>();
    requested.forEach((field, mediaId) -> {
      if (mediaId != null) {
        desired.put(field, mediaId);
      }
    });
    Map<String, MediaReference> existing = new LinkedHashMap<>();
    referenceMapper.selectBusinessReferences(domain, businessId)
        .forEach(reference -> existing.put(reference.getFieldKey(), reference));
    List<Long> released = new ArrayList<>();

    for (Map.Entry<String, MediaReference> entry : existing.entrySet()) {
      Long replacementId = desired.get(entry.getKey());
      if (!Objects.equals(entry.getValue().getMediaId(), replacementId)) {
        referenceMapper.deleteById(entry.getValue().getId());
        released.add(entry.getValue().getMediaId());
      }
    }

    for (Map.Entry<String, Long> entry : desired.entrySet()) {
      MediaReference current = existing.get(entry.getKey());
      boolean retainsCurrentReference = current != null && Objects.equals(current.getMediaId(), entry.getValue());
      MediaAsset asset = retainsCurrentReference
          ? assetService.requireReferencedAvailableForUpdate(entry.getValue())
          : assetService.requireAvailableForUpdate(entry.getValue());
      if (current == null || !Objects.equals(current.getMediaId(), asset.getId())) {
        MediaReference reference = new MediaReference();
        reference.setMediaId(asset.getId());
        reference.setBusinessDomain(domain);
        reference.setBusinessId(businessId);
        reference.setFieldKey(entry.getKey());
        reference.setOwnerClientCode(identity.clientCode());
        reference.setTenantId(identity.tenantId());
        reference.setStoreId(identity.storeId());
        reference.setCreatedAt(LocalDateTime.now());
        reference.setUpdatedAt(LocalDateTime.now());
        referenceMapper.insert(reference);
      }
      assetService.markReferenced(asset);
    }
    cleanupService.enqueueAfterCommit(released, "业务媒体被替换");
  }

  @Transactional
  public void removeBusiness(String domain, Long businessId, String reason) {
    List<Long> released = referenceMapper.selectBusinessReferences(domain, businessId).stream()
        .map(MediaReference::getMediaId).toList();
    referenceMapper.deleteBusinessReferences(domain, businessId);
    cleanupService.enqueueAfterCommit(released, reason);
  }
}
