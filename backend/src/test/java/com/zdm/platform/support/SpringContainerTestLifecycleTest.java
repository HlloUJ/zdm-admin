package com.zdm.platform.support;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.concurrent.atomic.AtomicBoolean;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.AfterAllCallback;
import org.junit.jupiter.api.extension.BeforeAllCallback;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.extension.ExtensionContext;
import org.springframework.beans.factory.DisposableBean;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.test.context.junit.jupiter.SpringJUnitConfig;

@SpringJUnitConfig(SpringContainerTestLifecycleTest.LifecycleConfiguration.class)
@ExtendWith(SpringContainerTestLifecycleTest.ContainerLifecycle.class)
class SpringContainerTestLifecycleTest extends SpringContainerTestSupport {
  private static final AtomicBoolean RESOURCE_AVAILABLE = new AtomicBoolean();
  private static final AtomicBoolean CONTEXT_DESTROYED = new AtomicBoolean();
  private static ConfigurableApplicationContext applicationContext;

  @Test
  void retainsResourcesUntilSpringContextIsClosed(@Autowired ConfigurableApplicationContext context) {
    applicationContext = context;
    assertThat(context.isActive()).isTrue();
    assertThat(RESOURCE_AVAILABLE).isTrue();
    assertThat(CONTEXT_DESTROYED).isFalse();
  }

  @TestConfiguration(proxyBeanMethods = false)
  static class LifecycleConfiguration {
    @Bean
    DisposableBean resourceDependentBean() {
      return () -> {
        assertThat(RESOURCE_AVAILABLE).as("container available during Spring teardown").isTrue();
        CONTEXT_DESTROYED.set(true);
      };
    }
  }

  /** Models a class-level container's extension callbacks without requiring Docker. */
  static class ContainerLifecycle implements BeforeAllCallback, AfterAllCallback {
    @Override
    public void beforeAll(ExtensionContext context) {
      RESOURCE_AVAILABLE.set(true);
      CONTEXT_DESTROYED.set(false);
    }

    @Override
    public void afterAll(ExtensionContext context) {
      try {
        assertThat(applicationContext).isNotNull();
        assertThat(applicationContext.isActive()).as("Spring closed before container teardown").isFalse();
        assertThat(CONTEXT_DESTROYED).isTrue();
      } finally {
        RESOURCE_AVAILABLE.set(false);
      }
    }
  }
}
