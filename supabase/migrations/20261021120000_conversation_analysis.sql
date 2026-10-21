alter table conversation_records
  add column analysis jsonb,
  add column analysis_source text check (analysis_source in ('llm', 'deterministic'));

alter table extracted_signals
  add column facts jsonb not null default '[]'::jsonb;
