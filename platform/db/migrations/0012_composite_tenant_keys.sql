-- Defence in depth for tenant isolation: every link between two tenant-owned rows now also matches on
-- tenant_id, so the database itself refuses (say) an interview of tenant A pointing at a job of tenant B,
-- even if application code or a policy had a bug. Row-level security stays the first line of defence.
--
-- Each foreign key (child.col → parent.id) becomes (child.tenant_id, child.col) → (parent.tenant_id, parent.id),
-- which needs a unique (tenant_id, id) on the parent. ON DELETE behaviour is kept; SET NULL only clears
-- the link column, never tenant_id. Adding the constraints checks every existing row.

DO $$
DECLARE
  parent text;
  fk record;
BEGIN
  FOREACH parent IN ARRAY ARRAY['question_banks', 'question_bank_versions', 'questions', 'jobs', 'rubrics', 'consent_texts',
                                'candidates', 'invitations', 'consent_records', 'interviews', 'interview_questions', 'answers'] LOOP
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I UNIQUE (tenant_id, id)', parent, parent || '_tenant_id_id_key');
  END LOOP;

  FOR fk IN SELECT * FROM (VALUES
    ('question_bank_versions', 'bank_id',               'question_banks',         'CASCADE'),
    ('questions',              'version_id',            'question_bank_versions', 'CASCADE'),
    ('question_audio',         'bank_id',               'question_banks',         'CASCADE'),
    ('jobs',                   'bank_id',               'question_banks',         'SET NULL (bank_id)'),
    ('rubrics',                'job_id',                'jobs',                   'CASCADE'),
    ('candidates',             'job_id',                'jobs',                   'CASCADE'),
    ('invitations',            'candidate_id',          'candidates',             'CASCADE'),
    ('consent_records',        'candidate_id',          'candidates',             'CASCADE'),
    ('consent_records',        'consent_text_id',       'consent_texts',          'NO ACTION'),
    ('consent_records',        'invitation_id',         'invitations',            'CASCADE'),
    ('interviews',             'bank_version_id',       'question_bank_versions', 'NO ACTION'),
    ('interviews',             'candidate_id',          'candidates',             'CASCADE'),
    ('interviews',             'consent_record_id',     'consent_records',        'NO ACTION'),
    ('interviews',             'invitation_id',         'invitations',            'CASCADE'),
    ('interviews',             'job_id',                'jobs',                   'CASCADE'),
    ('interviews',             'rubric_id',             'rubrics',                'NO ACTION'),
    ('interview_questions',    'interview_id',          'interviews',             'CASCADE'),
    ('interview_questions',    'question_id',           'questions',              'NO ACTION'),
    ('answers',                'interview_question_id', 'interview_questions',    'CASCADE'),
    ('transcription_jobs',     'answer_id',             'answers',                'CASCADE'),
    ('scores',                 'interview_id',          'interviews',             'CASCADE'),
    ('scores',                 'rubric_id',             'rubrics',                'NO ACTION'),
    ('scoring_jobs',           'interview_id',          'interviews',             'CASCADE'),
    ('usage_ledger',           'interview_id',          'interviews',             'SET NULL (interview_id)'),
    ('decisions',              'interview_id',          'interviews',             'CASCADE'),
    ('score_overrides',        'interview_id',          'interviews',             'CASCADE'),
    ('comments',               'interview_id',          'interviews',             'CASCADE'),
    ('rights_requests',        'candidate_id',          'candidates',             'SET NULL (candidate_id)'),
    ('calibration_ratings',    'interview_id',          'interviews',             'CASCADE')
  ) AS t(child, col, parent, on_delete) LOOP
    EXECUTE format('ALTER TABLE %I DROP CONSTRAINT %I', fk.child, fk.child || '_' || fk.col || '_fkey');
    EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (tenant_id, %I) REFERENCES %I (tenant_id, id) ON DELETE %s',
                   fk.child, fk.child || '_' || fk.col || '_fkey', fk.col, fk.parent, fk.on_delete);
  END LOOP;
END $$;
