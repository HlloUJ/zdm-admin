-- Current state activity, maintained transactionally by state mutation/log services.
-- Times use UTC; historical store log times use Asia/Shanghai wall time.
CREATE TABLE product_state_activity (
 kind VARCHAR(20) NOT NULL, business_client_code VARCHAR(20) NOT NULL,
 record_id BIGINT NOT NULL, state VARCHAR(20) NOT NULL,
 operator_account_id BIGINT NULL, operator_client_code VARCHAR(20) NULL,
 occurred_at DATETIME(6) NULL,
 PRIMARY KEY (kind, business_client_code, record_id),
 KEY idx_state_activity_sort (kind, business_client_code, state, occurred_at, record_id)
);
INSERT INTO product_state_activity
 SELECT 'finished',l.business_client_code,p.id,CASE WHEN l.business_client_code='supply-chain' THEN p.source_status ELSE p.status END,l.operator_account_id,l.operator_client_code,l.operated_at
 FROM finished_products p JOIN (
 SELECT logs.*,ROW_NUMBER() OVER (PARTITION BY product_id,business_client_code ORDER BY operated_at DESC,id DESC) AS rn
 FROM finished_operation_logs logs WHERE after_status IS NOT NULL AND (NOT(before_status <=> after_status) OR operation_type='CREATE')
 ) l ON l.product_id=p.id AND l.rn=1 AND l.after_status=CASE WHEN l.business_client_code='supply-chain' THEN p.source_status ELSE p.status END;
INSERT IGNORE INTO product_state_activity (kind,business_client_code,record_id,state) SELECT 'finished','supply-chain',id,source_status FROM finished_products;
INSERT IGNORE INTO product_state_activity (kind,business_client_code,record_id,state) SELECT 'finished','admin',id,status FROM finished_products;
INSERT INTO product_state_activity
 SELECT 'slab',l.business_client_code,p.id,CASE WHEN l.business_client_code='supply-chain' THEN p.source_status ELSE p.status END,l.operator_account_id,l.operator_client_code,l.operated_at
 FROM slab_inventory p JOIN (
 SELECT logs.*,ROW_NUMBER() OVER (PARTITION BY slab_id,business_client_code ORDER BY operated_at DESC,id DESC) AS rn
 FROM slab_operation_logs logs WHERE after_status IS NOT NULL AND (NOT(before_status <=> after_status) OR operation_type='CREATE')
 ) l ON l.slab_id=p.id AND l.rn=1 AND l.after_status=CASE WHEN l.business_client_code='supply-chain' THEN p.source_status ELSE p.status END;
INSERT IGNORE INTO product_state_activity (kind,business_client_code,record_id,state) SELECT 'slab','supply-chain',id,source_status FROM slab_inventory;
INSERT IGNORE INTO product_state_activity (kind,business_client_code,record_id,state) SELECT 'slab','admin',id,status FROM slab_inventory;
INSERT INTO product_state_activity
 SELECT 'store-finished','store',p.id,p.status,l.operator_account_id,CASE WHEN l.operation_type LIKE 'SOURCE\_%' THEN 'supply-chain' WHEN l.operation_type LIKE 'OPERATIONS\_%' THEN 'admin' ELSE 'store' END,DATE_SUB(l.operated_at,INTERVAL 8 HOUR)
 FROM store_finished_products p JOIN (
 SELECT logs.*,ROW_NUMBER() OVER (PARTITION BY listing_id ORDER BY operated_at DESC,id DESC) AS rn
 FROM store_finished_operation_logs logs WHERE after_status IS NOT NULL AND (NOT(before_status <=> after_status) OR operation_type='CREATE')
 ) l ON l.listing_id=p.id AND l.rn=1 AND l.after_status=p.status;
INSERT IGNORE INTO product_state_activity (kind,business_client_code,record_id,state) SELECT 'store-finished','store',id,status FROM store_finished_products;
UPDATE product_state_activity a JOIN store_finished_products s ON s.id=a.record_id JOIN finished_products p ON p.id=s.finished_product_id SET a.state='soldOut',a.operator_account_id=NULL,a.operator_client_code='system',a.occurred_at=NULL WHERE a.kind='store-finished' AND s.status='selling' AND s.invalidated_at IS NULL AND p.total_stock=0;
