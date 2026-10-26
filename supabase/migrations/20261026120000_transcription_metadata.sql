alter table conversation_records
  add column transcription_metadata jsonb;

comment on column conversation_records.transcription_metadata is
  'Raw/normalized transcript plus uncertainty, temporal-scope and STT correction metadata. Never rewrites the original transcript.';
