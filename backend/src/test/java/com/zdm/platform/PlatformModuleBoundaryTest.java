package com.zdm.platform;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class PlatformModuleBoundaryTest {
  private static final Set<String> BUSINESS_MODULES = Set.of(
      "catalog",
      "craft",
      "employee",
      "inventory",
      "order",
      "role",
      "store",
      "supplier",
      "tenant");
  private static final Pattern PLATFORM_IMPORT =
      Pattern.compile("^import com\\.zdm\\.platform\\.([a-z]+)\\.", Pattern.MULTILINE);

  @Test
  void businessModulesDoNotImportEachOthersInternals() throws IOException {
    Path platformSource = Path.of("src/main/java/com/zdm/platform");
    List<String> violations = new ArrayList<>();

    for (String sourceModule : BUSINESS_MODULES) {
      Path moduleSource = platformSource.resolve(sourceModule);
      if (!Files.exists(moduleSource)) {
        continue;
      }
      try (var sourceFiles = Files.walk(moduleSource)) {
        sourceFiles
            .filter(path -> path.toString().endsWith(".java"))
            .forEach(path -> inspectImports(platformSource, sourceModule, path, violations));
      }
    }

    assertThat(violations)
        .as("业务模块应通过明确的公共契约协作，不能直接引用其他业务模块内部实现")
        .isEmpty();
  }

  private void inspectImports(
      Path platformSource,
      String sourceModule,
      Path sourceFile,
      List<String> violations) {
    try {
      Matcher matcher = PLATFORM_IMPORT.matcher(Files.readString(sourceFile));
      while (matcher.find()) {
        String targetModule = matcher.group(1);
        if (BUSINESS_MODULES.contains(targetModule) && !sourceModule.equals(targetModule)) {
          violations.add(
              platformSource.relativize(sourceFile) + " imports business module " + targetModule);
        }
      }
    } catch (IOException ex) {
      throw new IllegalStateException("无法读取模块源码: " + sourceFile, ex);
    }
  }
}
