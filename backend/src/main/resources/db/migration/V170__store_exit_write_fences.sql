-- Keep every scoped late writer behind a real parent-row constraint, without server-wide privileges.
ALTER TABLE store_finished_operation_logs
  ADD CONSTRAINT fk_exit_finished_log_store FOREIGN KEY (store_id) REFERENCES stores(id);
ALTER TABLE store_accessory_operation_logs
  ADD CONSTRAINT fk_exit_accessory_log_store FOREIGN KEY (store_id) REFERENCES stores(id);
ALTER TABLE store_payment_names
  ADD CONSTRAINT fk_exit_payment_name_store FOREIGN KEY (store_id) REFERENCES stores(id);
ALTER TABLE store_payment_name_events
  ADD CONSTRAINT fk_exit_payment_event_store FOREIGN KEY (store_id) REFERENCES stores(id);
ALTER TABLE employee_invite_acceptances
  ADD CONSTRAINT fk_exit_invite_acceptance FOREIGN KEY (invite_id) REFERENCES employee_invites(id);
