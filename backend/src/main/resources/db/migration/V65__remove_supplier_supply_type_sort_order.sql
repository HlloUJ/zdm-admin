ALTER TABLE supplier_supply_types
  DROP INDEX idx_supplier_supply_types_status_sort,
  DROP COLUMN sort_order,
  ADD KEY idx_supplier_supply_types_status (status, id);
