package com.zdm.platform.media;

import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/open/media")
public class OpenMediaController {
  private final MediaAssetService assetService;

  public OpenMediaController(MediaAssetService assetService) {
    this.assetService = assetService;
  }

  @GetMapping("/{publicId}")
  public ResponseEntity<Resource> get(@PathVariable String publicId) {
    MediaAsset asset = assetService.findPublic(publicId);
    if (asset == null || !"public".equals(asset.getAccessLevel())) {
      return ResponseEntity.notFound().build();
    }
    MediaType mediaType = MediaType.parseMediaType(asset.getMimeType());
    return ResponseEntity.ok().contentType(mediaType).body(assetService.load(publicId));
  }
}
