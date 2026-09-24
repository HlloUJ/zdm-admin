package com.zdm.platform.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Comparator;
import java.util.List;
import org.springframework.core.io.ClassPathResource;

/** Shared with the frontend catalog; specific prefixes override their parent scope. */
public final class FunctionAudiencePolicy {
  private record Rule(String prefix, String scope) {}

  private static final List<Rule> RULES = loadRules();

  private FunctionAudiencePolicy() {}

  private static List<Rule> loadRules() {
    try (var input = new ClassPathResource("function-audience-policy.json").getInputStream()) {
      return List.copyOf(new ObjectMapper().readValue(input, new TypeReference<List<Rule>>() {}));
    } catch (IOException exception) {
      throw new IllegalStateException("Cannot load function audience policy", exception);
    }
  }

  public static boolean allows(String permission, String audience) {
    if (!List.of("admin", "store", "supplier", "supply-chain").contains(audience)) {
      return false;
    }
    return RULES.stream()
        .filter(rule -> permission.equals(rule.prefix()) || permission.startsWith(rule.prefix() + "."))
        .max(Comparator.comparingInt(rule -> rule.prefix().length()))
        .map(rule -> switch (rule.scope()) {
          case "shared-management" -> !"supply-chain".equals(audience) || permission.equals(rule.prefix());
          case "internal-management" -> List.of("admin", "supply-chain").contains(audience);
          case "shared" -> !"supply-chain".equals(audience);
          case "admin-only" -> "admin".equals(audience);
          case "store-only" -> "store".equals(audience);
          case "terminal-only" -> List.of("store", "supplier").contains(audience);
          case "supply-chain-only" -> "supply-chain".equals(audience);
          case "supplier-directory" -> !"admin".equals(audience);
          default -> false;
        })
        .orElse(false);
  }

  public static boolean allows(String permission, CurrentIdentity identity) {
    String audience = "supply-chain".equals(identity.clientCode()) ? "supply-chain" : identity.storeId() != null ? "store" : identity.tenantId() == null ? "admin" : "";
    return allows(permission, audience);
  }

  public static List<String> filter(List<String> permissions, String audience) {
    return permissions.stream().filter(permission -> allows(permission, audience)).toList();
  }
}
