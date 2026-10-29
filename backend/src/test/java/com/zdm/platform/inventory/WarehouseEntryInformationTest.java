package com.zdm.platform.inventory;
import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
class WarehouseEntryInformationTest {
 @Test void classifiesKnownIngressAndDoesNotGuessUnknownCreation() {
  for (String operation : java.util.List.of("CREATE","SELECT","SOURCE_SHELF")) {
   assertThat(WarehouseEntryInformation.fromEvent(null,"warehouse",operation,null,null).type()).isEqualTo("firstEntry");
  }
  assertThat(WarehouseEntryInformation.fromEvent("recycle","warehouse","RESTORE",null,null).type()).isEqualTo("recycleRestore");
  assertThat(WarehouseEntryInformation.fromEvent(null,"warehouse","REENTRY",null,null).type()).isEqualTo("sourceReentry");
  assertThat(WarehouseEntryInformation.fromEvent("selling","warehouse","UPDATE",null,null).type()).isEqualTo("editReturn");
  assertThat(WarehouseEntryInformation.fromEvent(null,"warehouse",null,null,null).type()).isNull();
 }
 @Test void onlyDownIngressCarriesCurrentReasonAndOtherTransitionsClearIt() {
  var down=WarehouseEntryInformation.fromEvent("selling","warehouse","OFF_SHELF","价格调整","改图");
  assertThat(down).isEqualTo(new WarehouseEntryInformation("offShelf","价格调整","改图"));
  assertThat(WarehouseEntryInformation.fromEvent("selling","warehouse","SOURCE_UPDATE","价格调整",null).type()).isEqualTo("offShelf");
  for (String operation : java.util.List.of("CREATE","SELECT","SOURCE_SHELF","RESTORE","REENTRY")) {
   var entry=WarehouseEntryInformation.fromEvent(null,"warehouse",operation,"旧原因","旧说明");
   assertThat(entry.reason()).isNull(); assertThat(entry.detail()).isNull();
  }
  assertThat(WarehouseEntryInformation.fromEvent("warehouse","selling","SHELF","旧原因","旧说明")).isEqualTo(new WarehouseEntryInformation(null,null,null));
 }
}
