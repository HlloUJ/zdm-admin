package com.zdm.platform.common;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class CategoryProductCountsTest {
  private record Category(Long id, Long parentId, int count, String scope) {}

  private Map<Long, Integer> counts(List<Category> categories) {
    return CategoryProductCounts.rollUp(categories, Category::id, Category::parentId,
        Category::count, (child, parent) -> child.scope().equals(parent.scope()));
  }

  @Test
  void fourLevelsIncludeDirectProductsAndSiblingBranchesExactlyOnce() {
    assertThat(counts(List.of(
        new Category(4L, 3L, 3, "finished"),
        new Category(5L, 3L, 2, "finished"),
        new Category(6L, 2L, 4, "finished"),
        new Category(3L, 2L, 0, "finished"),
        new Category(2L, 1L, 1, "finished"),
        new Category(1L, null, 2, "finished"))))
        .containsExactlyInAnyOrderEntriesOf(Map.of(1L, 12, 2L, 10, 3L, 5, 4L, 3, 5L, 2, 6L, 4));
  }

  @Test
  void missingParentsAndOtherScopesDoNotReceiveCounts() {
    assertThat(counts(List.of(
        new Category(1L, null, 0, "finished"),
        new Category(2L, 1L, 3, "accessory"),
        new Category(3L, 99L, 2, "finished"))))
        .containsExactlyInAnyOrderEntriesOf(Map.of(1L, 0, 2L, 3, 3L, 2));
  }

  @Test
  void malformedCyclesTerminateAndNeverCountTheSameProductTwicePerNode() {
    assertThat(counts(List.of(
        new Category(1L, 2L, 2, "finished"),
        new Category(2L, 1L, 3, "finished"),
        new Category(3L, 3L, 1, "finished"))))
        .containsExactlyInAnyOrderEntriesOf(Map.of(1L, 5, 2L, 5, 3L, 1));
  }

  @Test
  void emptyTreeHasNoCounts() {
    assertThat(counts(List.of())).isEmpty();
  }
}
