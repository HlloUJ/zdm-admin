DELETE FROM platform_orders
WHERE order_no = 'SO202607270001'
  AND remark = '订单中心最小样例数据';

ALTER TABLE employees
  DROP FOREIGN KEY fk_employees_store;
ALTER TABLE employees
  ADD CONSTRAINT fk_employees_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL;

ALTER TABLE account_identities
  DROP FOREIGN KEY fk_account_identities_store;
ALTER TABLE account_identities
  ADD CONSTRAINT fk_account_identities_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL;

ALTER TABLE account_roles
  DROP FOREIGN KEY fk_account_roles_store;
ALTER TABLE account_roles
  ADD CONSTRAINT fk_account_roles_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL;

ALTER TABLE employee_invites
  DROP FOREIGN KEY fk_employee_invites_store;
ALTER TABLE employee_invites
  ADD CONSTRAINT fk_employee_invites_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL;

ALTER TABLE roles
  DROP FOREIGN KEY fk_roles_store;

ALTER TABLE platform_orders
  DROP FOREIGN KEY fk_platform_orders_store;
ALTER TABLE platform_orders
  ADD CONSTRAINT fk_platform_orders_store
    FOREIGN KEY (store_id) REFERENCES stores (id) ON DELETE SET NULL;
