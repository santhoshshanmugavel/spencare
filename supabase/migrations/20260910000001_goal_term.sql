-- Reference fidelity pass (Goals-9.pdf / Goals-6.pdf): the Goals grid has a
-- "Short term / Long term" segmented control that actually filters which
-- goals are shown -- not a cosmetic label. No existing column distinguishes
-- a goal's term, so this adds one.
--
-- Default 'short' for both the column default and existing rows: every goal
-- created before this migration keeps behaving exactly as it did (visible,
-- just now classified as "short term") rather than silently disappearing
-- from a filtered view the day this ships.
create type goal_term as enum ('short', 'long');

alter table goals
  add column term goal_term not null default 'short';
