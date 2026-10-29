-- Current warehouse entry belongs to the same admitted record/business scope as state activity.
-- Retain operation logs and historical snapshots; never infer first entry from an absent reason.
ALTER TABLE product_state_activity
 ADD COLUMN warehouse_entry_type VARCHAR(30) NULL,
 ADD COLUMN warehouse_entry_reason VARCHAR(500) NULL,
 ADD COLUMN warehouse_entry_detail TEXT NULL;

INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'finished','admin',id,status FROM finished_products;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'finished','supply-chain',id,source_status FROM finished_products;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'accessory','admin',id,status FROM accessory_products;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'accessory','supply-chain',id,source_status FROM accessory_products;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'slab','admin',id,status FROM slab_inventory;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'slab','supply-chain',id,source_status FROM slab_inventory;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'store-finished','store',id,status FROM store_finished_products;
INSERT IGNORE INTO product_state_activity(kind,business_client_code,record_id,state) SELECT 'store-accessory','store',id,status FROM store_accessory_products;

UPDATE product_state_activity activity
JOIN (
 SELECT events.*, ROW_NUMBER() OVER (PARTITION BY kind,business_client_code,record_id ORDER BY operated_at DESC,id DESC) AS sequence_number
 FROM (
SELECT 'finished' AS kind,business_client_code,product_id AS record_id,operation_type,before_status,after_status,standard_reason,detail_reason,operated_at,id FROM finished_operation_logs
 UNION ALL
SELECT 'accessory' AS kind,business_client_code,product_id AS record_id,operation_type,before_status,after_status,standard_reason,detail_reason,operated_at,id FROM accessory_operation_logs
 UNION ALL
SELECT 'slab' AS kind,business_client_code,slab_id AS record_id,operation_type,before_status,after_status,standard_reason,detail_reason,operated_at,id FROM slab_operation_logs
 UNION ALL
SELECT 'store-finished' AS kind,'store' AS business_client_code,listing_id AS record_id,operation_type,before_status,after_status,NULLIF(JSON_UNQUOTE(CASE WHEN JSON_TYPE(JSON_EXTRACT(change_details, '$."下架原因"'))='OBJECT' THEN JSON_EXTRACT(change_details, '$."下架原因".after') ELSE JSON_EXTRACT(change_details, '$."下架原因"') END),'null') AS standard_reason,NULLIF(JSON_UNQUOTE(CASE WHEN JSON_TYPE(JSON_EXTRACT(change_details, '$."详细说明"'))='OBJECT' THEN JSON_EXTRACT(change_details, '$."详细说明".after') ELSE JSON_EXTRACT(change_details, '$."详细说明"') END),'null') AS detail_reason,DATE_SUB(operated_at,INTERVAL 8 HOUR) AS operated_at,id FROM store_finished_operation_logs
 UNION ALL
SELECT 'store-accessory' AS kind,'store' AS business_client_code,listing_id AS record_id,operation_type,before_status,after_status,NULLIF(JSON_UNQUOTE(CASE WHEN JSON_TYPE(JSON_EXTRACT(change_details, '$."下架原因"'))='OBJECT' THEN JSON_EXTRACT(change_details, '$."下架原因".after') ELSE JSON_EXTRACT(change_details, '$."下架原因"') END),'null') AS standard_reason,NULLIF(JSON_UNQUOTE(CASE WHEN JSON_TYPE(JSON_EXTRACT(change_details, '$."详细说明"'))='OBJECT' THEN JSON_EXTRACT(change_details, '$."详细说明".after') ELSE JSON_EXTRACT(change_details, '$."详细说明"') END),'null') AS detail_reason,DATE_SUB(operated_at,INTERVAL 8 HOUR) AS operated_at,id FROM store_accessory_operation_logs
 ) events
 WHERE after_status IS NOT NULL AND (NOT(before_status <=> after_status) OR operation_type IN ('CREATE','SELECT','REENTRY'))
) latest ON latest.kind=activity.kind AND latest.business_client_code=activity.business_client_code
 AND latest.record_id=activity.record_id AND latest.sequence_number=1
SET activity.warehouse_entry_type=CASE
 WHEN latest.operation_type='OFF_SHELF' OR (latest.operation_type='SOURCE_UPDATE' AND latest.before_status='selling') THEN 'offShelf'
 WHEN latest.operation_type IN ('RESTORE','RESTORE_WAREHOUSE','RESTORE_RECYCLE') AND latest.before_status='recycle' THEN 'recycleRestore'
 WHEN latest.operation_type IN ('CREATE','SELECT','SOURCE_SHELF') AND latest.before_status IS NULL THEN 'firstEntry'
 WHEN latest.operation_type='REENTRY' THEN 'sourceReentry'
 WHEN latest.operation_type='UPDATE' AND latest.before_status='selling' THEN 'editReturn'
 ELSE NULL END,
 activity.warehouse_entry_reason=CASE WHEN latest.operation_type='OFF_SHELF' OR (latest.operation_type='SOURCE_UPDATE' AND latest.before_status='selling') THEN latest.standard_reason ELSE NULL END,
 activity.warehouse_entry_detail=CASE WHEN latest.operation_type='OFF_SHELF' OR (latest.operation_type='SOURCE_UPDATE' AND latest.before_status='selling') THEN latest.detail_reason ELSE NULL END
WHERE activity.state='warehouse' AND latest.after_status='warehouse';

-- A missing audit must not become "first entry". Preserve surviving current notes without inventing provenance.
UPDATE product_state_activity a JOIN finished_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.off_shelf_reason,a.warehouse_entry_detail=p.off_shelf_detail WHERE a.kind='finished' AND a.business_client_code='admin' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;
UPDATE product_state_activity a JOIN finished_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.source_off_shelf_reason,a.warehouse_entry_detail=p.source_off_shelf_detail WHERE a.kind='finished' AND a.business_client_code='supply-chain' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;
UPDATE product_state_activity a JOIN accessory_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.off_shelf_reason,a.warehouse_entry_detail=p.off_shelf_detail WHERE a.kind='accessory' AND a.business_client_code='admin' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;
UPDATE product_state_activity a JOIN accessory_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.source_off_shelf_reason,a.warehouse_entry_detail=p.source_off_shelf_detail WHERE a.kind='accessory' AND a.business_client_code='supply-chain' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;
UPDATE product_state_activity a JOIN store_finished_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.off_shelf_reason,a.warehouse_entry_detail=p.off_shelf_detail WHERE a.kind='store-finished' AND a.business_client_code='store' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;
UPDATE product_state_activity a JOIN store_accessory_products p ON p.id=a.record_id SET a.warehouse_entry_reason=p.off_shelf_reason,a.warehouse_entry_detail=p.off_shelf_detail WHERE a.kind='store-accessory' AND a.business_client_code='store' AND a.state='warehouse' AND a.warehouse_entry_type IS NULL;

-- All active reads/writes now use activity metadata. Action inputs and immutable log fields retain their names.
ALTER TABLE finished_products DROP COLUMN off_shelf_reason, DROP COLUMN off_shelf_detail, DROP COLUMN off_shelf_at, DROP COLUMN source_off_shelf_reason, DROP COLUMN source_off_shelf_detail, DROP COLUMN source_off_shelf_at;
ALTER TABLE accessory_products DROP COLUMN off_shelf_reason, DROP COLUMN off_shelf_detail, DROP COLUMN off_shelf_at, DROP COLUMN source_off_shelf_reason, DROP COLUMN source_off_shelf_detail, DROP COLUMN source_off_shelf_at;
ALTER TABLE store_finished_products DROP COLUMN off_shelf_reason, DROP COLUMN off_shelf_detail, DROP COLUMN off_shelf_at;
ALTER TABLE store_accessory_products DROP COLUMN off_shelf_reason, DROP COLUMN off_shelf_detail, DROP COLUMN off_shelf_at;
