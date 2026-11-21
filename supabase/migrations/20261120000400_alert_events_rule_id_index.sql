-- Supabase advisor (unindexed_foreign_keys): alert_events.rule_id references alert_rules(id) with no covering index,
-- so deleting a rule (on delete cascade) scans alert_events. Covering index for the foreign key.
create index if not exists alert_events_rule_id_idx on public.alert_events (rule_id);
