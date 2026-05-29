-- Batch G (G4): remove the test-only `name[] <@ text[]` operator and its
-- backing function from the production schema (F-02-003). The four pgTAP suites
-- that used it now cast attname::text and rely on the built-in text[] <@ text[]
-- operator, so this custom operator is dead.

DROP OPERATOR IF EXISTS <@ (name[], text[]);
DROP FUNCTION IF EXISTS name_array_contained_by_text_array(name[], text[]);
