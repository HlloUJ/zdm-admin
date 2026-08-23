package com.zdm.platform.media;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.FileTime;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MediaStorageService {
  private static final long MAX_IMAGE_SIZE = 10L * 1024 * 1024;
  private static final long MAX_VIDEO_SIZE = 100L * 1024 * 1024;
  private static final Map<String, String> ALLOWED_TYPES = Map.of(
      "image/jpeg", ".jpg",
      "image/png", ".png",
      "image/gif", ".gif",
      "image/webp", ".webp",
      "video/mp4", ".mp4",
      "video/webm", ".webm",
      "video/quicktime", ".mov");

  private final Path storageRoot;

  public MediaStorageService(@Value("${zdm.media.storage-path:/data/zdm/craft-images}") String storagePath) {
    this.storageRoot = Path.of(storagePath).toAbsolutePath().normalize();
  }

  public StoredMedia store(MultipartFile file, long imageSizeLimit) {
    if (file.isEmpty()) {
      throw new IllegalArgumentException("请选择媒体文件");
    }
    String contentType = file.getContentType();
    String mimeType = contentType == null
        ? ""
        : contentType.toLowerCase(Locale.ROOT);
    String extension = ALLOWED_TYPES.get(mimeType);
    if (extension == null) {
      throw new IllegalArgumentException("仅支持 JPG、PNG、GIF、WEBP 图片及 MP4、WEBM、MOV 视频");
    }
    String mediaType = mimeType.startsWith("video/") ? "video" : "image";
    long sizeLimit = "video".equals(mediaType) ? MAX_VIDEO_SIZE : Math.min(imageSizeLimit, MAX_IMAGE_SIZE);
    if (file.getSize() > sizeLimit) {
      throw new IllegalArgumentException("image".equals(mediaType)
          ? "图片不能超过" + sizeLimit / 1024 / 1024 + "MB"
          : "视频不能超过100MB");
    }

    String publicId = UUID.randomUUID().toString();
    String storageKey = "media/" + publicId + extension;
    Path target = resolve(storageKey);
    try {
      Files.createDirectories(storageRoot.resolve("media"));
      try (InputStream inputStream = file.getInputStream()) {
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件保存失败", exception);
    }
    return new StoredMedia(publicId, storageKey, mediaType, mimeType, file.getSize());
  }

  public Resource load(String storageKey) {
    try {
      return new UrlResource(resolve(storageKey).toUri());
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件读取失败", exception);
    }
  }

  public long delete(String storageKey) {
    Path target = resolve(storageKey);
    try {
      long size = Files.exists(target) ? Files.size(target) : 0L;
      Files.deleteIfExists(target);
      return size;
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件删除失败", exception);
    }
  }

  public List<StoredFile> listManagedFiles() {
    if (!Files.isDirectory(storageRoot)) {
      return List.of();
    }
    try (Stream<Path> paths = Files.walk(storageRoot)) {
      return paths.filter(Files::isRegularFile)
          .filter(this::isManagedFile)
          .map(this::toStoredFile)
          .toList();
    } catch (IOException exception) {
      throw new IllegalStateException("媒体存储目录扫描失败", exception);
    }
  }

  private boolean isManagedFile(Path path) {
    String key = storageRoot.relativize(path).toString().replace('\\', '/');
    return key.matches("(?:media/|slabs/)?[0-9a-f-]{36}\\.(jpg|png|gif|webp|mp4|webm|mov)");
  }

  private StoredFile toStoredFile(Path path) {
    try {
      String key = storageRoot.relativize(path).toString().replace('\\', '/');
      FileTime modifiedAt = Files.getLastModifiedTime(path);
      return new StoredFile(key, Files.size(path), modifiedAt.toInstant());
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件信息读取失败", exception);
    }
  }

  private Path resolve(String storageKey) {
    if (storageKey == null || storageKey.isBlank() || storageKey.startsWith("/")) {
      throw new IllegalArgumentException("媒体文件地址无效");
    }
    Path target = storageRoot.resolve(storageKey).normalize();
    if (!target.startsWith(storageRoot)) {
      throw new IllegalArgumentException("媒体文件地址无效");
    }
    return target;
  }

  public static long defaultImageSizeLimit() {
    return MAX_IMAGE_SIZE;
  }

  public record StoredMedia(
      String publicId, String storageKey, String mediaType, String mimeType, long fileSize) {}

  public record StoredFile(String storageKey, long fileSize, Instant modifiedAt) {}
}
