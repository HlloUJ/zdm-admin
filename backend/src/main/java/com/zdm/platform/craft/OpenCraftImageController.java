package com.zdm.platform.craft;

import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/open/craft-images")
public class OpenCraftImageController {
  private final CraftImageStorageService imageStorageService;

  public OpenCraftImageController(CraftImageStorageService imageStorageService) {
    this.imageStorageService = imageStorageService;
  }

  @GetMapping("/{filename:.+}")
  public ResponseEntity<Resource> getImage(@PathVariable String filename) {
    Resource resource = imageStorageService.load(filename);
    if (!resource.exists() || !resource.isReadable()) {
      return ResponseEntity.notFound().build();
    }

    MediaType mediaType = MediaTypeFactory.getMediaType(filename)
        .orElse(MediaType.APPLICATION_OCTET_STREAM);
    return ResponseEntity.ok().contentType(mediaType).body(resource);
  }
}
