SET search_path TO rethread,public;
CREATE OR REPLACE FUNCTION rethread.validate_case_transition() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed jsonb := '{"queued":["capturing","cancelled","blocked","unsupported","failed","needs_input"],"capturing":["reproducing","needs_input","unsupported","blocked","failed","cancelled"],"reproducing":["diagnosing","needs_input","blocked","failed","cancelled"],"diagnosing":["proposing","needs_input","blocked","failed","cancelled"],"proposing":["verifying","failed","blocked","cancelled"],"verifying":["ready_for_review","failed","blocked","cancelled"],"ready_for_review":["publishing","rejected","cancelled","superseded"],"publishing":["pr_opened","ready_for_review","superseded","failed","cancelled","blocked"],"pr_opened":[],"needs_input":[],"unsupported":[],"blocked":[],"failed":[],"cancelled":[],"rejected":[],"superseded":[]}';
BEGIN
 IF NEW.state<>OLD.state AND NOT (allowed->OLD.state ? NEW.state) THEN
  RAISE EXCEPTION 'Invalid Case state transition: % -> %',OLD.state,NEW.state;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER case_state_transition BEFORE UPDATE OF state ON cases FOR EACH ROW EXECUTE FUNCTION rethread.validate_case_transition();
CREATE UNIQUE INDEX preflight_correlation ON jobs(tenant_id,(payload->>'correlation')) WHERE kind='preflight';
