package com.zdm.platform.inventory;

import java.time.LocalDateTime;

public interface StateActivityAware {
 Long getId();
 String getStatus();
 String getSourceStatus();
 void setStateOperatedAt(LocalDateTime value);
 void setStateOperatorName(String value);
 void setWarehouseEntryType(String value);
 void setWarehouseEntryReason(String value);
 void setWarehouseEntryDetail(String value);
}
