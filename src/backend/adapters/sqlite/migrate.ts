import { DatabaseSync } from 'node:sqlite';

export function migrate(db: DatabaseSync): void {
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
  `);
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
    db.exec(`
      CREATE TABLE clients (
        id TEXT PRIMARY KEY, name TEXT NOT NULL CHECK(length(trim(name)) > 0),
        active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE cases (
        id TEXT PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE RESTRICT,
        reference TEXT NOT NULL, title TEXT NOT NULL,
        hourly_rate_cents INTEGER CHECK(hourly_rate_cents IS NULL OR hourly_rate_cents >= 0),
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE INDEX cases_client_idx ON cases(client_id);
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY, started_at TEXT NOT NULL, ended_at TEXT,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(ended_at IS NULL OR julianday(ended_at) >= julianday(started_at))
      );
      CREATE UNIQUE INDEX one_open_session ON sessions((1)) WHERE ended_at IS NULL;
      CREATE TABLE work_periods (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        case_id TEXT REFERENCES cases(id) ON DELETE RESTRICT,
        initial_case_id TEXT REFERENCES cases(id) ON DELETE RESTRICT,
        initial_origin TEXT NOT NULL CHECK(initial_origin IN ('unresolved','automatic','lawyer')),
        started_at TEXT NOT NULL, ended_at TEXT,
        detected_duration_ms INTEGER CHECK(detected_duration_ms IS NULL OR detected_duration_ms >= 0),
        duration_override_ms INTEGER CHECK(duration_override_ms IS NULL OR duration_override_ms >= 0),
        assignment_origin TEXT NOT NULL DEFAULT 'unresolved' CHECK(assignment_origin IN ('unresolved','automatic','lawyer')),
        time_validation_status TEXT NOT NULL DEFAULT 'unvalidated' CHECK(time_validation_status IN ('unvalidated','validated')),
        effective_revision INTEGER NOT NULL DEFAULT 0 CHECK(effective_revision >= 0),
        validated_effective_revision INTEGER CHECK(validated_effective_revision IS NULL OR validated_effective_revision >= 0),
        time_validated_at TEXT,
        billing_status TEXT NOT NULL DEFAULT 'unbilled' CHECK(billing_status IN ('unbilled','billed')),
        billed_at TEXT,
        applied_hourly_rate_cents INTEGER CHECK(applied_hourly_rate_cents IS NULL OR applied_hourly_rate_cents >= 0),
        applied_currency TEXT,
        revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0),
        assignment_revision INTEGER NOT NULL DEFAULT 0 CHECK(assignment_revision >= 0),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        CHECK(ended_at IS NULL OR julianday(ended_at) >= julianday(started_at)),
        CHECK((billing_status = 'billed') = (billed_at IS NOT NULL)),
        CHECK((time_validation_status = 'validated' AND validated_effective_revision = effective_revision AND time_validated_at IS NOT NULL) OR (time_validation_status = 'unvalidated' AND validated_effective_revision IS NULL AND time_validated_at IS NULL))
      );
      CREATE INDEX periods_session_idx ON work_periods(session_id, started_at);
      CREATE INDEX periods_case_idx ON work_periods(case_id);
      CREATE UNIQUE INDEX one_open_period_per_session ON work_periods(session_id) WHERE ended_at IS NULL;
      CREATE TRIGGER period_bounds_insert BEFORE INSERT ON work_periods BEGIN
        SELECT RAISE(ABORT, 'period outside session') WHERE
          julianday(NEW.started_at) < julianday((SELECT started_at FROM sessions WHERE id = NEW.session_id)) OR
          (SELECT ended_at FROM sessions WHERE id = NEW.session_id) IS NOT NULL AND
          (julianday(NEW.started_at) > julianday((SELECT ended_at FROM sessions WHERE id = NEW.session_id)) OR
           NEW.ended_at IS NULL OR julianday(NEW.ended_at) > julianday((SELECT ended_at FROM sessions WHERE id = NEW.session_id)));
      END;
      CREATE TRIGGER period_bounds_update BEFORE UPDATE OF session_id,started_at,ended_at ON work_periods BEGIN
        SELECT RAISE(ABORT, 'period outside session') WHERE
          julianday(NEW.started_at) < julianday((SELECT started_at FROM sessions WHERE id = NEW.session_id)) OR
          (SELECT ended_at FROM sessions WHERE id = NEW.session_id) IS NOT NULL AND
          (julianday(NEW.started_at) > julianday((SELECT ended_at FROM sessions WHERE id = NEW.session_id)) OR
           NEW.ended_at IS NULL OR julianday(NEW.ended_at) > julianday((SELECT ended_at FROM sessions WHERE id = NEW.session_id)));
      END;
      CREATE TRIGGER session_end_bounds BEFORE UPDATE OF ended_at ON sessions WHEN NEW.ended_at IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'period exceeds session') WHERE EXISTS(
          SELECT 1 FROM work_periods WHERE session_id = NEW.id AND (ended_at IS NULL OR julianday(ended_at) > julianday(NEW.ended_at)));
      END;
      -- The imported demonstration has overlapping observed blocks. An overlap
      -- cannot establish worked duration until reconstruction is decided.
      CREATE TABLE tag_targets (
        id TEXT PRIMARY KEY, screenpipe_instance_id TEXT NOT NULL,
        target_type TEXT NOT NULL, target_id TEXT NOT NULL,
        work_period_id TEXT REFERENCES work_periods(id) ON DELETE RESTRICT,
        target_revision INTEGER NOT NULL DEFAULT 0 CHECK(target_revision >= 0),
        UNIQUE(screenpipe_instance_id,target_type,target_id)
      );
      CREATE TABLE sources (
        id TEXT PRIMARY KEY, work_period_id TEXT REFERENCES work_periods(id) ON DELETE RESTRICT,
        screenpipe_instance_id TEXT NOT NULL, content_type TEXT NOT NULL, external_id TEXT NOT NULL,
        tag_target_id TEXT REFERENCES tag_targets(id) ON DELETE RESTRICT,
        recorded_at TEXT NOT NULL, ingested_at TEXT NOT NULL,
        app_name TEXT, window_name TEXT, url TEXT,
        validation_status TEXT NOT NULL DEFAULT 'unvalidated' CHECK(validation_status IN ('unvalidated','validated')),
        validated_at TEXT,
        availability_status TEXT NOT NULL DEFAULT 'unknown' CHECK(availability_status IN ('unknown','available','unavailable')),
        availability_checked_at TEXT,
        UNIQUE(screenpipe_instance_id,content_type,external_id),
        CHECK((validation_status = 'validated') = (validated_at IS NOT NULL))
      );
      CREATE INDEX sources_period_idx ON sources(work_period_id);
      CREATE INDEX sources_target_idx ON sources(tag_target_id);
      CREATE TRIGGER source_target_owner_insert BEFORE INSERT ON sources WHEN NEW.tag_target_id IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'source target owner mismatch') WHERE
          NEW.screenpipe_instance_id != (SELECT screenpipe_instance_id FROM tag_targets WHERE id=NEW.tag_target_id) OR
          NEW.work_period_id IS NOT (SELECT work_period_id FROM tag_targets WHERE id=NEW.tag_target_id);
      END;
      CREATE TRIGGER source_target_owner_update BEFORE UPDATE OF work_period_id,tag_target_id,screenpipe_instance_id ON sources WHEN NEW.tag_target_id IS NOT NULL BEGIN
        SELECT RAISE(ABORT, 'source target owner mismatch') WHERE
          NEW.screenpipe_instance_id != (SELECT screenpipe_instance_id FROM tag_targets WHERE id=NEW.tag_target_id) OR
          NEW.work_period_id IS NOT (SELECT work_period_id FROM tag_targets WHERE id=NEW.tag_target_id);
      END;
      CREATE TRIGGER target_owner_update BEFORE UPDATE OF work_period_id ON tag_targets BEGIN
        SELECT RAISE(ABORT, 'target has aliases with another owner') WHERE EXISTS(
          SELECT 1 FROM sources WHERE tag_target_id=NEW.id AND work_period_id IS NOT NEW.work_period_id);
      END;
      CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        global_hourly_rate_cents INTEGER NOT NULL CHECK(global_hourly_rate_cents >= 0),
        currency TEXT NOT NULL, workspace_id TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE processed_commands (
        producer_id TEXT NOT NULL, command_id TEXT NOT NULL, kind TEXT NOT NULL,
        payload_fingerprint TEXT NOT NULL, session_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','applied','rejected')),
        prerequisite_id TEXT, payload_json TEXT NOT NULL, result_json TEXT,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY(producer_id,command_id)
      );
      CREATE INDEX commands_pending_idx ON processed_commands(producer_id,prerequisite_id,status);
      CREATE TABLE pending_questions (
        question_id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        work_period_id TEXT NOT NULL REFERENCES work_periods(id) ON DELETE RESTRICT,
        expected_assignment_revision INTEGER NOT NULL CHECK(expected_assignment_revision >= 0),
        status TEXT NOT NULL CHECK(status IN ('pending','answered','superseded')),
        response_command_id TEXT, response_result_json TEXT,
        UNIQUE(session_id,work_period_id,expected_assignment_revision)
      );
      CREATE TABLE reconstruction_conflicts (
        id TEXT PRIMARY KEY, protected_period_id TEXT NOT NULL REFERENCES work_periods(id) ON DELETE RESTRICT,
        expected_revision INTEGER NOT NULL CHECK(expected_revision >= 0),
        proposed_started_at TEXT NOT NULL, proposed_ended_at TEXT,
        source_references_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
        CHECK(proposed_ended_at IS NULL OR julianday(proposed_ended_at) >= julianday(proposed_started_at))
      );
      CREATE TABLE retrieval_progress (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE RESTRICT,
        screenpipe_instance_id TEXT NOT NULL, requested_start_at TEXT NOT NULL,
        requested_end_at TEXT NOT NULL, cursor TEXT, last_completed_at TEXT,
        status TEXT NOT NULL CHECK(status IN ('pending','complete','failed')),
        CHECK(julianday(requested_end_at) >= julianday(requested_start_at))
      );
      CREATE TABLE assignment_deliveries (
        id TEXT PRIMARY KEY, tag_target_id TEXT NOT NULL REFERENCES tag_targets(id) ON DELETE RESTRICT,
        target_revision INTEGER NOT NULL CHECK(target_revision >= 0),
        intended_tags_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','verified','failed','blocked')),
        attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts >= 0),
        next_retry_at TEXT, acknowledged_at TEXT,
        UNIQUE(tag_target_id,target_revision)
      );
    `);
    db.prepare('INSERT INTO schema_migrations(version) VALUES (1)').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 2').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE clients ADD COLUMN code TEXT;
        ALTER TABLE clients ADD COLUMN type TEXT NOT NULL DEFAULT 'individual';
        ALTER TABLE clients ADD COLUMN mode TEXT NOT NULL DEFAULT 'hourly';
        ALTER TABLE clients ADD COLUMN hourly_rate_cents INTEGER CHECK(hourly_rate_cents IS NULL OR hourly_rate_cents >= 0);
        ALTER TABLE clients ADD COLUMN vat_applicable INTEGER NOT NULL DEFAULT 1 CHECK(vat_applicable IN (0,1));
        ALTER TABLE clients ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';
        CREATE UNIQUE INDEX clients_code_idx ON clients(code) WHERE code IS NOT NULL;
        ALTER TABLE cases ADD COLUMN category TEXT NOT NULL DEFAULT '';
        ALTER TABLE cases ADD COLUMN case_number TEXT NOT NULL DEFAULT '';
        ALTER TABLE cases ADD COLUMN opposing_party TEXT NOT NULL DEFAULT '';
        ALTER TABLE cases ADD COLUMN mode TEXT NOT NULL DEFAULT 'hourly' CHECK(mode IN ('hourly','flat_fee'));
        ALTER TABLE cases ADD COLUMN flat_fee_cents INTEGER CHECK(flat_fee_cents IS NULL OR flat_fee_cents >= 0);
        ALTER TABLE cases ADD COLUMN hour_cap REAL CHECK(hour_cap IS NULL OR hour_cap >= 0);
        ALTER TABLE cases ADD COLUMN success_fee_percent REAL;
        ALTER TABLE cases ADD COLUMN budget_cents INTEGER CHECK(budget_cents IS NULL OR budget_cents >= 0);
        ALTER TABLE cases ADD COLUMN opened_on TEXT;
        CREATE UNIQUE INDEX cases_reference_idx ON cases(reference);
        ALTER TABLE work_periods ADD COLUMN task_type_id INTEGER REFERENCES task_types(id);
        ALTER TABLE work_periods ADD COLUMN label TEXT NOT NULL DEFAULT '';
        ALTER TABLE work_periods ADD COLUMN billable INTEGER NOT NULL DEFAULT 1 CHECK(billable IN (0,1));
        ALTER TABLE work_periods ADD COLUMN nonbillable_reason TEXT;
        ALTER TABLE work_periods ADD COLUMN excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1));
        ALTER TABLE work_periods ADD COLUMN demo_app TEXT;
        ALTER TABLE work_periods ADD COLUMN demo_window_title TEXT;
        ALTER TABLE work_periods ADD COLUMN demo_confidence REAL;
        ALTER TABLE work_periods ADD COLUMN invoice_id INTEGER REFERENCES invoices(id);
        ALTER TABLE sources ADD COLUMN excerpt TEXT;
        ALTER TABLE sources ADD COLUMN detected_marker TEXT;
        ALTER TABLE settings ADD COLUMN lawyer_name TEXT;
        ALTER TABLE settings ADD COLUMN address TEXT;
        ALTER TABLE settings ADD COLUMN vat_number TEXT;
        ALTER TABLE settings ADD COLUMN base_unit TEXT NOT NULL DEFAULT 'hour';
        ALTER TABLE settings ADD COLUMN vat_rate REAL NOT NULL DEFAULT 20;
        ALTER TABLE settings ADD COLUMN confidence_threshold REAL NOT NULL DEFAULT 0.8;
        ALTER TABLE settings ADD COLUMN excluded_apps TEXT NOT NULL DEFAULT '';
        ALTER TABLE settings ADD COLUMN capture_retention TEXT NOT NULL DEFAULT '';
        ALTER TABLE settings ADD COLUMN notifications INTEGER NOT NULL DEFAULT 1;
        ALTER TABLE settings ADD COLUMN pill_position TEXT NOT NULL DEFAULT 'top';
        ALTER TABLE settings ADD COLUMN invoice_prefix TEXT NOT NULL DEFAULT 'F-2026-';
        ALTER TABLE settings ADD COLUMN next_number INTEGER NOT NULL DEFAULT 1;
        CREATE TABLE task_types (
          id INTEGER PRIMARY KEY, code TEXT NOT NULL UNIQUE, label TEXT NOT NULL,
          billable_by_default INTEGER NOT NULL CHECK(billable_by_default IN (0,1)),
          off_screen INTEGER NOT NULL CHECK(off_screen IN (0,1)), sort_order INTEGER NOT NULL
        );
        CREATE TABLE markers (
          id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
          type TEXT NOT NULL, value TEXT NOT NULL, weight REAL NOT NULL CHECK(weight BETWEEN 0 AND 1),
          learned INTEGER NOT NULL DEFAULT 0, hits INTEGER NOT NULL DEFAULT 0, last_seen_at TEXT,
          UNIQUE(case_id,type,value)
        );
        CREATE TABLE client_rules (
          id INTEGER PRIMARY KEY, client_id TEXT NOT NULL REFERENCES clients(id),
          type TEXT NOT NULL, value INTEGER NOT NULL CHECK(value >= 0), label TEXT NOT NULL
        );
        CREATE TABLE invoices (
          id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id),
          number TEXT NOT NULL UNIQUE, date TEXT NOT NULL, type TEXT NOT NULL,
          status TEXT NOT NULL
        );
        CREATE TABLE invoice_lines (
          id INTEGER PRIMARY KEY, invoice_id INTEGER NOT NULL REFERENCES invoices(id),
          origin TEXT NOT NULL, origin_id TEXT NOT NULL, label TEXT NOT NULL,
          billed_minutes INTEGER NOT NULL CHECK(billed_minutes >= 0),
          rate_cents INTEGER NOT NULL CHECK(rate_cents >= 0),
          amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0), vat INTEGER NOT NULL CHECK(vat IN (0,1))
        );
        CREATE TABLE expenses (
          id INTEGER PRIMARY KEY, case_id TEXT NOT NULL REFERENCES cases(id), date TEXT NOT NULL,
          label TEXT NOT NULL, type TEXT NOT NULL, amount_cents INTEGER NOT NULL CHECK(amount_cents >= 0),
          invoice_id INTEGER REFERENCES invoices(id)
        );
        CREATE TABLE audit_events (
          id INTEGER PRIMARY KEY, work_period_id TEXT REFERENCES work_periods(id),
          timestamp TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
          before TEXT NOT NULL, after TEXT NOT NULL
        );
        CREATE TABLE source_exports (
          id INTEGER PRIMARY KEY, period_ids_json TEXT NOT NULL, options_json TEXT NOT NULL,
          sha256 TEXT NOT NULL, created_at TEXT NOT NULL
        );
        CREATE TABLE jev_reviews (
          id INTEGER PRIMARY KEY, work_period_id TEXT NOT NULL REFERENCES work_periods(id),
          question TEXT NOT NULL, answer TEXT NOT NULL, probability REAL NOT NULL,
          sent_data TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (2)').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 3').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`
        ALTER TABLE invoices ADD COLUMN subtotal_cents INTEGER;
        ALTER TABLE invoices ADD COLUMN vat_cents INTEGER;
        ALTER TABLE invoices ADD COLUMN disbursements_cents INTEGER;
        ALTER TABLE invoices ADD COLUMN total_cents INTEGER;
        ALTER TABLE invoices ADD COLUMN snapshot_json TEXT;
        ALTER TABLE invoice_lines ADD COLUMN period_ids_json TEXT;
      `);
      db.prepare('INSERT INTO schema_migrations(version) VALUES (3)').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
  if (!db.prepare('SELECT 1 FROM schema_migrations WHERE version = 4').get()) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(`CREATE TABLE demo_block_periods (
        block_id INTEGER PRIMARY KEY,
        period_id TEXT NOT NULL UNIQUE REFERENCES work_periods(id) ON DELETE RESTRICT
      )`);
      if (db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='block'").get()) {
        db.exec(`INSERT OR IGNORE INTO demo_block_periods(block_id,period_id)
          SELECT b.id,p.id FROM block b JOIN work_periods p
            ON p.started_at=b.date||'T'||b.start_time||':00Z'
            AND p.demo_app=b.app AND p.demo_window_title=b.window_title`);
        db.exec(`INSERT OR IGNORE INTO demo_block_periods(block_id,period_id)
          SELECT e.block_id,p.id FROM time_entry e JOIN work_periods p ON p.id=CAST(e.id AS TEXT)
          WHERE e.block_id IS NOT NULL`);
        db.exec(`INSERT OR IGNORE INTO demo_block_periods(block_id,period_id)
          SELECT b.id,p.id FROM block b JOIN work_periods p ON p.id='excluded-'||b.id`);
      }
      db.prepare('INSERT INTO schema_migrations(version) VALUES (4)').run();
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }
}
