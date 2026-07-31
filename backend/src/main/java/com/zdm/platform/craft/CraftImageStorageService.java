package com.zdm.platform.craft;

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
public class CraftImageStorageService {
  private static final long MAX_FILE_SIZE = 5L * 1024 * 1024;
  private static final Map<String, String> ALLOWED_IMAGE_TYPES = Map.of(
      "image/jpeg", ".jpg",
      "image/png", ".png",
      "image/gif", ".gif",
      "image/webp", ".webp");

  private final Path storagePath;

  public CraftImageStorageService(@Value("${zdm.craft-image.storage-path}") String storagePath) {
    this.storagePath = Path.of(storagePath).toAbsolutePath().normalize();
  }

  public String store(MultipartFile file) {
    if (file.isEmpty()) {
      throw new IllegalArgumentException("请选择工艺图片");
    }
    if (file.getSize() > MAX_FILE_SIZE) {
      throw new IllegalArgumentException("工艺图片不能超过5MB");
    }

    String originalContentType = file.getContentType();
    String contentType = originalContentType == null
        ? ""
        : originalContentType.toLowerCase(Locale.ROOT);
    String extension = ALLOWED_IMAGE_TYPES.get(contentType);
    if (extension == null) {
      throw new IllegalArgumentException("仅支持 JPG、PNG、GIF、WEBP 图片");
    }

    String filename = UUID.randomUUID() + extension;
    Path target = storagePath.resolve(filename).normalize();
    try {
      Files.createDirectories(storagePath);
      try (InputStream inputStream = file.getInputStream()) {
        Files.copy(inputStream, target, StandardCopyOption.REPLACE_EXISTING);
      }
    } catch (IOException exception) {
      throw new IllegalStateException("工艺图片保存失败", exception);
    }
    return "/api/open/craft-images/" + filename;
  }

  public Resource load(String filename) {
    if (!filename.matches("[0-9a-f-]{36}\\.(jpg|png|gif|webp)")) {
      throw new IllegalArgumentException("工艺图片地址无效");
    }

    Path target = storagePath.resolve(filename).normalize();
    if (!target.startsWith(storagePath)) {
      throw new IllegalArgumentException("工艺图片地址无效");
    }

    try {
      return new UrlResource(target.toUri());
    } catch (IOException exception) {
      throw new IllegalStateException("工艺图片读取失败", exception);
    }
  }
}
