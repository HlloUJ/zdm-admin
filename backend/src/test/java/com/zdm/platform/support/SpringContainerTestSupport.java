package com.zdm.platform.support;

import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.TestInfo;
import org.springframework.test.annotation.DirtiesContext.HierarchyMode;
import org.springframework.test.context.TestContextManager;

/** Closes Spring resources while the test class's containers are still available. */
public abstract class SpringContainerTestSupport {
  @AfterAll
  protected static void closeContextBeforeContainerTeardown(TestInfo testInfo) {
    // User @AfterAll methods run before extension callbacks stop @Container resources.
    // Evict through Spring's shared cache so later test listeners cannot read a closed context.
    new TestContextManager(testInfo.getTestClass().orElseThrow()).getTestContext()
        .markApplicationContextDirty(HierarchyMode.CURRENT_LEVEL);
  }
}
