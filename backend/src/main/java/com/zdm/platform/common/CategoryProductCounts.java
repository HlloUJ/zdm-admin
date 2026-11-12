package com.zdm.platform.common;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.function.BiPredicate;
import java.util.function.Function;
import java.util.function.ToIntFunction;

/** Computes response-only subtree counts from each category's direct product count. */
public final class CategoryProductCounts {
  private CategoryProductCounts() {}

  public static <T> Map<Long, Integer> rollUp(
      List<T> categories,
      Function<T, Long> id,
      Function<T, Long> parentId,
      ToIntFunction<T> directCount,
      BiPredicate<T, T> sameScope) {
    Map<Long, T> nodes = new HashMap<>();
    Map<Long, Integer> totals = new HashMap<>();
    for (T category : categories) {
      nodes.put(id.apply(category), category);
      totals.put(id.apply(category), 0);
    }
    for (T category : categories) {
      int count = directCount.applyAsInt(category);
      T current = category;
      var visited = new HashSet<Long>();
      while (current != null && sameScope.test(category, current)
          && visited.add(id.apply(current))) {
        Long currentId = id.apply(current);
        totals.put(currentId, Math.addExact(totals.get(currentId), count));
        current = nodes.get(parentId.apply(current));
      }
    }
    return totals;
  }
}
