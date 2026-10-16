package com.zdm.platform.customer;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.text.Collator;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;

/** Reference data only: no number-range, regional-length, carrier or reachability validation. */
@Component
public final class CustomerContactRegions {
  public record Nationality(String code, String name) {}
  public record PhoneRegion(String code, String name, String callingCode) {}
  public record Catalogue(List<Nationality> nationalities, List<PhoneRegion> phoneRegions) {
    public Catalogue { nationalities=List.copyOf(nationalities); phoneRegions=List.copyOf(phoneRegions); }
  }
  private final Set<String> nationalityCodes;
  private final Map<String,String> callingCodes;
  private final Catalogue catalogue;
  public CustomerContactRegions(ObjectMapper mapper) throws IOException {
    nationalityCodes=Set.copyOf(Arrays.asList(Locale.getISOCountries()));
    var countries=new ArrayList<Nationality>();
    for (String code:nationalityCodes) {
      countries.add(new Nationality(code,Locale.of("",code).getDisplayCountry(Locale.SIMPLIFIED_CHINESE)));
    }
    var codes=new HashMap<String,String>();
    try (var stream=new ClassPathResource("reference/contact-phone-regions.json").getInputStream()) {
      mapper.readTree(stream).path("callingCodes").fields().forEachRemaining(e -> codes.put(e.getKey(),e.getValue().asText()));
    }
    callingCodes=Map.copyOf(codes);
    var regions=new ArrayList<PhoneRegion>();
    codes.forEach((code,value) -> regions.add(new PhoneRegion(code,
        Locale.of("",code).getDisplayCountry(Locale.SIMPLIFIED_CHINESE),value)));
    var collator=Collator.getInstance(Locale.SIMPLIFIED_CHINESE);
    countries.sort((a,b) -> collator.compare(a.name(),b.name()));
    regions.sort((a,b) -> collator.compare(a.name(),b.name()));
    catalogue=new Catalogue(countries,regions);
  }
  public Catalogue catalogue() { return catalogue; }
  public String nationality(String code) {
    String value=code==null ? "" : code;
    if (!value.isEmpty() && !nationalityCodes.contains(value)) { throw new IllegalArgumentException("请选择有效的国籍"); }
    return value;
  }
  public String callingCode(String region) {
    if (region==null || region.isEmpty()) { return ""; }
    String value=callingCodes.get(region);
    if (value==null) { throw new IllegalArgumentException("请选择有效的号码所属国家／地区"); }
    return value;
  }
}
