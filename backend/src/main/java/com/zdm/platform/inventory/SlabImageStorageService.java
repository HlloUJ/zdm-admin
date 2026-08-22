package com.zdm.platform.inventory;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.Resource;
import org.springframework.core.io.UrlResource;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

@Service
public class SlabImageStorageService {
  private static final long MAX_FILE_SIZE = 100L * 1024 * 1024;
  private static final Map<String, String> ALLOWED_MEDIA_TYPES = Map.of(
      "image/jpeg", ".jpg",
      "image/png", ".png",
      "image/gif", ".gif",
      "image/webp", ".webp",
      "video/mp4", ".mp4",
      "video/webm", ".webm",
      "video/quicktime", ".mov");

  private final Path storagePath;

  public SlabImageStorageService(
      @Value("${zdm.slab-image.storage-path:./data/slab-images}") String storagePath) {
    this.storagePath = Path.of(storagePath).toAbsolutePath().normalize();
  }

  public String store(MultipartFile file) {
    if (file.isEmpty()) {
      throw new IllegalArgumentException("请选择媒体文件");
    }
    if (file.getSize() > MAX_FILE_SIZE) {
      throw new IllegalArgumentException("媒体文件不能超过100MB");
    }
    String contentType = file.getContentType() == null
        ? ""
        : file.getContentType().toLowerCase(Locale.ROOT);
    String extension = ALLOWED_MEDIA_TYPES.get(contentType);
    if (extension == null) {
      throw new IllegalArgumentException("仅支持 JPG、PNG、GIF、WEBP 图片及 MP4、WEBM、MOV 视频");
    }

    String filename = UUID.randomUUID() + extension;
    Path target = storagePath.resolve(filename).normalize();
    try {
      Files.createDirectories(storagePath);
      try (InputStream inputStream = file.getInputStream()) {
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件保存失败", exception);
    }
    return "/api/open/slab-images/" + filename;
  }

  public Resource load(String filename) {
    if (!filename.matches("[0-9a-f-]{36}\\.(jpg|png|gif|webp|mp4|webm|mov)")) {
      throw new IllegalArgumentException("媒体文件地址无效");
    }
    Path target = storagePath.resolve(filename).normalize();
    if (!target.startsWith(storagePath)) {
      throw new IllegalArgumentException("媒体文件地址无效");
    }
    try {
      return new UrlResource(target.toUri());
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件读取失败", exception);
    }
  }

  public boolean delete(String url) {
    String prefix = "/api/open/slab-images/";
    if (url == null || !url.startsWith(prefix)) {
      return false;
    }
    String filename = url.substring(prefix.length());
    if (!filename.matches("[0-9a-f-]{36}\\.(jpg|png|gif|webp|mp4|webm|mov)")) {
      return false;
    }
    Path target = storagePath.resolve(filename).normalize();
    if (!target.startsWith(storagePath)) {
      return false;
    }
    try {
      return Files.deleteIfExists(target);
    } catch (IOException exception) {
      throw new IllegalStateException("媒体文件删除失败", exception);
    }
  }
}
