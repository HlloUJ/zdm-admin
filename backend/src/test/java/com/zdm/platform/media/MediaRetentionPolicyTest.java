package com.zdm.platform.media;

import static org.assertj.core.api.Assertions.assertThat;
import java.time.LocalDateTime;
import org.junit.jupiter.api.Test;

class MediaRetentionPolicyTest {
  @Test
  void historyUses180DaysPlus24HourBufferAndRequiresPreview() {
    LocalDateTime released = LocalDateTime.of(2026, 1, 1, 0, 0);
    MediaAsset asset = new MediaAsset();
    asset.setStatus("active");
    asset.setUnreferencedSince(released);
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 1, 0, released.plusYears(1)).eligible()).isFalse();
    asset.setHistoryPreviewState("ready");
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 1, 0, released.plusDays(180)).eligible()).isFalse();
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 1, 0, released.plusDays(181)).eligible()).isTrue();
    assertThat(MediaRetentionPolicy.evaluate(asset, 1, 1, 0, released.plusYears(1)).eligible()).isFalse();
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 1, 1, released.plusYears(1)).eligible()).isFalse();
  }

  @Test
  void temporaryAndExplicitlyReleasedMediaHave24HourBuffer() {
    LocalDateTime created = LocalDateTime.of(2026, 1, 1, 0, 0);
    MediaAsset asset = new MediaAsset();
    asset.setStatus("temporary");
    asset.setCreatedAt(created);
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 0, 0, created.plusHours(23)).eligible()).isFalse();
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 0, 0, created.plusHours(24)).eligible()).isTrue();
    asset.setUnreferencedSince(created.plusDays(3));
    assertThat(MediaRetentionPolicy.evaluate(asset, 0, 0, 0, created.plusDays(3).plusHours(1)).eligible()).isFalse();
  }
}
