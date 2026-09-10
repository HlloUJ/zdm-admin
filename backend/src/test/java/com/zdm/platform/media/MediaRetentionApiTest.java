package com.zdm.platform.media;

import static org.assertj.core.api.Assertions.assertThat;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.MySQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import com.zdm.platform.security.CurrentIdentity;

@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class MediaRetentionApiTest {
  @Container
  static final MySQLContainer<?> MYSQL = new MySQLContainer<>("mysql:8.0")
      .withDatabaseName("media_retention_test").withUsername("zdm_admin").withPassword("zdm_admin_pwd");
  static final Path ROOT = Path.of(System.getProperty("java.io.tmpdir"), "media-retention-" + UUID.randomUUID());
  @DynamicPropertySource
  static void properties(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", MYSQL::getJdbcUrl);
    registry.add("spring.datasource.username", MYSQL::getUsername);
    registry.add("spring.datasource.password", MYSQL::getPassword);
    registry.add("zdm.media.storage-path", ROOT::toString);
  }
  @Autowired MediaAssetService assets;
  @Autowired MediaReferenceService references;
  @Autowired MediaHistoryService history;
  @Autowired MediaRetentionService retention;
  @Autowired MediaCleanupService cleanup;
  @Autowired MediaCleanupWorker worker;
  @Autowired JdbcTemplate jdbc;
  @Autowired org.springframework.transaction.PlatformTransactionManager transactionManager;
  @Autowired MediaAdminController admin;

  @BeforeEach
  void login() {
    var identity = new CurrentIdentity(1L, 1L, 1L, 1L, "admin", null, null, "测试", "all", List.of("SUPER_ADMIN"), List.of("all"));
    SecurityContextHolder.getContext().setAuthentication(new UsernamePasswordAuthenticationToken(identity, null, List.of()));
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=FALSE,migration_completed=TRUE WHERE id=1");
  }
  @AfterEach
  void clear() { SecurityContextHolder.clearContext(); }

  private Long image() throws Exception {
    ByteArrayOutputStream bytes = new ByteArrayOutputStream();
    ImageIO.write(new BufferedImage(1800, 900, BufferedImage.TYPE_INT_RGB), "png", bytes);
    return assets.upload(new MockMultipartFile("file", "history.png", "image/png", bytes.toByteArray()), MediaStorageService.defaultImageSizeLimit()).id();
  }

  private void runCleanup(Long id) {
    Long task = cleanup.enqueue(id, "test", "隔离数据库测试", false);
    if (task != null) { worker.process(task); }
  }

  @Test
  void originalExpiresButSharedHistoryPreviewSurvives() throws Exception {
    Long id = image();
    references.replace("TEST_PRODUCT", id, Map.of("image", id));
    history.retain("TEST_LOG", id, Map.of("before", id));
    history.retain("TEST_LOG_2", id, Map.of("after", id));
    history.generatePreview(id);
    Long previewId = assets.getById(id).getHistoryPreviewMediaId();
    assertThat(previewId).isNotNull();
    assertThat(retention.count(previewId, "PREVIEW")).isEqualTo(2);
    references.removeBusiness("TEST_PRODUCT", id, "替换图片");
    assertThat(retention.evaluate(assets.getById(id)).eligible()).isFalse();
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 182 DAY) WHERE id=?", id);
    runCleanup(id);
    assertThat(assets.getById(id).getStatus()).isNotEqualTo("deleted");
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=TRUE WHERE id=1");
    runCleanup(id);
    assertThat(assets.getById(id).getStatus()).isEqualTo("deleted");
    assertThat(history.view(id, "image")).containsEntry("previewOnly", true).containsEntry("available", true);
    assertThat(assets.getById(previewId).getStatus()).isNotEqualTo("deleted");
    history.release("TEST_LOG", id);
    assertThat(retention.count(previewId, "PREVIEW")).isEqualTo(1);
    history.release("TEST_LOG_2", id);
    assertThat(retention.count(previewId, "PREVIEW")).isZero();
    assertThat(assets.getById(previewId).getUnreferencedSince()).isNotNull();
  }

  @Test
  void sharedBusinessReferenceAndReattachmentCancelDeletion() throws Exception {
    Long id = image();
    references.replace("TEST_A", id, Map.of("image", id));
    references.replace("TEST_B", id, Map.of("image", id));
    references.removeBusiness("TEST_A", id, "删除一个引用");
    assertThat(assets.getById(id).getUnreferencedSince()).isNull();
    references.removeBusiness("TEST_B", id, "最后引用解除");
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 2 DAY) WHERE id=?", id);
    references.replace("TEST_C", id, Map.of("image", id));
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=TRUE WHERE id=1");
    runCleanup(id);
    assertThat(assets.getById(id).getStatus()).isEqualTo("active");
    assertThat(assets.getById(id).getUnreferencedSince()).isNull();
  }

  @Test
  void missingPreviewProtectsVideoAndReportsFailure() {
    Long id = assets.upload(new MockMultipartFile("file", "video.mp4", "video/mp4", new byte[] {1,2,3}), MediaStorageService.defaultImageSizeLimit()).id();
    history.retain("TEST_VIDEO_LOG", id, Map.of("video", id));
    history.generatePreview(id);
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 182 DAY) WHERE id=?", id);
    assertThat(assets.getById(id).getHistoryPreviewState()).isEqualTo("failed");
    assertThat(retention.evaluate(assets.getById(id)).eligible()).isFalse();
  }
  @Test
  void missingGeneratedPreviewStillProtectsOriginal() throws Exception {
    Long id = image();
    history.retain("TEST_MISSING_PREVIEW", id, Map.of("image", id));
    history.generatePreview(id);
    var preview = assets.getById(assets.getById(id).getHistoryPreviewMediaId());
    java.nio.file.Files.delete(ROOT.resolve(preview.getStorageKey()));
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 182 DAY) WHERE id=?", id);
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=TRUE WHERE id=1");
    runCleanup(id);
    assertThat(assets.getById(id).getStatus()).isNotEqualTo("deleted");
    assertThat(retention.evaluate(assets.getById(id)).reason()).contains("预览文件缺失");
  }

  @Test
  void expiredVideoUsesPosterWithoutPlayback() throws Exception {
    Long video = assets.upload(new MockMultipartFile("file", "video.mp4", "video/mp4", new byte[] {1,2,3}), MediaStorageService.defaultImageSizeLimit()).id();
    Long cover = image();
    jdbc.update("UPDATE media_assets SET derived_from_media_id=? WHERE id=?", video, cover);
    history.retain("TEST_POSTER", video, Map.of("video", video));
    history.generatePreview(video);
    assertThat(assets.getById(video).getHistoryPreviewState()).isEqualTo("ready");
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 182 DAY) WHERE id=?", video);
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=TRUE WHERE id=1");
    runCleanup(video);
    assertThat(history.view(video, "video")).containsEntry("mediaType", "image").containsEntry("previewOnly", true);
  }

  @Test
  void webpDecoderIsRegistered() {
    assertThat(ImageIO.getImageReadersByMIMEType("image/webp").hasNext()).isTrue();
  }

  @Test
  void rolledBackBusinessAndHistoryReferencesDoNotLeak() throws Exception {
    Long id = image();
    new org.springframework.transaction.support.TransactionTemplate(transactionManager).executeWithoutResult(status -> {
      references.replace("ROLLBACK_PRODUCT", id, Map.of("image", id));
      history.retain("ROLLBACK_LOG", id, Map.of("image", id));
      status.setRollbackOnly();
    });
    assertThat(retention.count(id, "BUSINESS")).isZero();
    assertThat(retention.count(id, "HISTORY")).isZero();
    assertThat(assets.getById(id).getStatus()).isEqualTo("temporary");
  }

  @Test
  void manualHoldPreventsDeletionAndRecordsReason() throws Exception {
    Long id = image();
    admin.hold(new MediaAdminController.HoldRequest(id, true, "人工核查"));
    jdbc.update("UPDATE media_assets SET unreferenced_since=DATE_SUB(NOW(),INTERVAL 182 DAY) WHERE id=?", id);
    jdbc.update("UPDATE media_lifecycle_control SET deletion_enabled=TRUE WHERE id=1");
    runCleanup(id);
    assertThat(assets.getById(id).getStatus()).isNotEqualTo("deleted");
    assertThat(retention.count(id, "MANUAL")).isEqualTo(1);
    admin.hold(new MediaAdminController.HoldRequest(id, false, "核查完成"));
    assertThat(retention.count(id, "MANUAL")).isZero();
    assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM media_lifecycle_events WHERE media_id=?", Long.class, id)).isEqualTo(2);
  }

}
