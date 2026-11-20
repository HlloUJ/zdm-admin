package com.zdm.platform.media;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.nio.channels.FileChannel;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/** Durable, non-public same-filesystem staging. Receipts are retained for idempotent recovery. */
@Service
public final class MediaDeletionQuarantine {
  private final Path root;
  private final ObjectMapper json;

  public MediaDeletionQuarantine(@Value("${zdm.media.storage-path:/data/zdm/craft-images}") String storagePath,
      ObjectMapper json) {
    Path configured = Path.of(storagePath).toAbsolutePath().normalize();
    try { this.root = Files.exists(configured) ? configured.toRealPath() : configured; }
    catch (IOException exception) { throw new IllegalStateException("媒体存储根目录不可核实", exception); }
    this.json = json.copy();
  }

  private record Receipt(long id, String publicId, String key, long size, String digest) { }

  public synchronized boolean hasRecord(MediaAsset asset) {
    return Files.exists(receiptPath(asset), LinkOption.NOFOLLOW_LINKS);
  }

  public synchronized long stage(MediaAsset asset) {
    try {
      Path source = source(asset), folder = folder(asset);
      Files.createDirectories(folder);
      checkPath(folder);
      Receipt receipt;
      if (hasRecord(asset)) {
        receipt = read(asset);
      } else {
        requireFile(source);
        receipt = new Receipt(asset.getId(), asset.getPublicId(), asset.getStorageKey(), Files.size(source), digest(source));
        if (asset.getFileSize() == null || asset.getFileSize() != receipt.size()) {
          throw new IllegalStateException("媒体文件大小与登记不一致");
        }
        Path temporary = folder.resolve("receipt-" + java.util.UUID.randomUUID() + ".tmp");
        Files.write(temporary, json.writeValueAsBytes(receipt), StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
        force(temporary);
        Files.move(temporary, receiptPath(asset), StandardCopyOption.ATOMIC_MOVE);
        force(folder);
        force(java.util.Objects.requireNonNull(folder.getParent(), "隔离父目录缺失"));
        force(root);
      }
      Path blob = folder.resolve("payload");
      if (Files.exists(blob, LinkOption.NOFOLLOW_LINKS)) {
        verify(blob, receipt);
        if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) { throw new IllegalStateException("媒体原位置与隔离文件冲突"); }
      } else {
        verify(source, receipt);
        Files.move(source, blob, StandardCopyOption.ATOMIC_MOVE);
        force(folder);
        force(java.util.Objects.requireNonNull(source.getParent(), "媒体父目录缺失"));
        verify(blob, receipt);
      }
      return receipt.size();
    } catch (IOException exception) { throw new IllegalStateException("媒体隔离失败，原证据保留", exception); }
  }

  public synchronized boolean restore(MediaAsset asset) {
    if (!hasRecord(asset)) { return false; }
    try {
      Receipt receipt = read(asset);
      Path source = source(asset), blob = folder(asset).resolve("payload");
      if (!Files.exists(blob, LinkOption.NOFOLLOW_LINKS)) {
        verify(source, receipt);
        return false;
      }
      verify(blob, receipt);
      if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) { throw new IllegalStateException("媒体恢复目标已存在，禁止覆盖"); }
      Files.move(blob, source, StandardCopyOption.ATOMIC_MOVE);
      force(java.util.Objects.requireNonNull(source.getParent(), "媒体父目录缺失"));
      force(folder(asset));
      return true;
    } catch (IOException exception) { throw new IllegalStateException("媒体隔离恢复失败", exception); }
  }

  /** Caller holds the asset lock in a new transaction AFTER its deleted state committed. */
  public synchronized long finish(MediaAsset asset) {
    if (!"deleted".equals(asset.getStatus())) { throw new IllegalStateException("媒体删除尚未提交"); }
    try {
      Receipt receipt = read(asset);
      Path source = source(asset), blob = folder(asset).resolve("payload");
      if (Files.exists(source, LinkOption.NOFOLLOW_LINKS)) { throw new IllegalStateException("媒体原位置出现文件，禁止销毁"); }
      if (Files.exists(blob, LinkOption.NOFOLLOW_LINKS)) {
        verify(blob, receipt);
        Files.delete(blob);
        force(folder(asset));
      }
      return receipt.size();
    } catch (IOException exception) { throw new IllegalStateException("媒体隔离收尾失败", exception); }
  }

  private Receipt read(MediaAsset asset) throws IOException {
    Path path = receiptPath(asset);
    requireFile(path);
    Receipt receipt = json.readValue(Files.readAllBytes(path), Receipt.class);
    if (receipt.id() != asset.getId() || !java.util.Objects.equals(receipt.publicId(), asset.getPublicId())
        || !java.util.Objects.equals(receipt.key(), asset.getStorageKey()) || asset.getFileSize() == null
        || receipt.size() != asset.getFileSize() || receipt.digest() == null || !receipt.digest().matches("[a-f0-9]{64}")) {
      throw new IllegalStateException("媒体隔离身份凭证不一致");
    }
    return receipt;
  }

  private Path folder(MediaAsset asset) {
    if (asset.getId() == null || asset.getId() <= 0) { throw new IllegalStateException("媒体标识无效"); }
    Path path = root.resolve(".deletion-quarantine").resolve(asset.getId().toString());
    checkPath(path);
    return path;
  }

  private Path receiptPath(MediaAsset asset) { return folder(asset).resolve("receipt.json"); }

  private Path source(MediaAsset asset) {
    String key = asset.getStorageKey();
    if (key == null || !key.matches("(?:media/|slabs/)?[0-9a-f-]{36}\\.(jpg|png|gif|webp|mp4|webm|mov|attachment)")) {
      throw new IllegalStateException("媒体删除路径不属于受控文件");
    }
    Path path = root.resolve(key).normalize();
    checkPath(path);
    return path;
  }

  private void checkPath(Path path) {
    if (!path.startsWith(root)) { throw new IllegalStateException("媒体路径越界"); }
    for (Path part = path; part != null; part = part.getParent()) {
      if (Files.isSymbolicLink(part)) { throw new IllegalStateException("媒体路径不允许符号链接"); }
    }
  }

  private void requireFile(Path path) {
    checkPath(path);
    if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) { throw new IllegalStateException("媒体文件缺失，待核查"); }
  }

  private void verify(Path path, Receipt receipt) throws IOException {
    requireFile(path);
    if (Files.size(path) != receipt.size() || !digest(path).equals(receipt.digest())) {
      throw new IllegalStateException("媒体隔离文件内容不一致");
    }
  }

  private String digest(Path path) throws IOException {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      try (var input = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS)) {
        byte[] bytes = new byte[8192];
        int count;
        while ((count = input.read(bytes)) != -1) { digest.update(bytes, 0, count); }
      }
      return HexFormat.of().formatHex(digest.digest());
    } catch (NoSuchAlgorithmException exception) { throw new IllegalStateException(exception); }
  }

  private void force(Path path) throws IOException {
    try (FileChannel channel = FileChannel.open(path, StandardOpenOption.READ)) { channel.force(true); }
  }
}
