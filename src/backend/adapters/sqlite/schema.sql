PRAGMA foreign_keys = ON;

-- Firm identity and default billing.
CREATE TABLE firm (
  id INTEGER PRIMARY KEY,
  lawyer_name TEXT NOT NULL,
  address TEXT NOT NULL,
  vat_number TEXT NOT NULL,
  base_rate_cents INTEGER NOT NULL CHECK(base_rate_cents>=0),
  base_unit TEXT NOT NULL CHECK(base_unit IN ('hour','intervention')),
  vat_rate REAL NOT NULL CHECK(vat_rate>=0 AND vat_rate<=100)
);

-- Local application preferences.
CREATE TABLE setting (
  id INTEGER PRIMARY KEY,
  confidence_threshold REAL NOT NULL CHECK(confidence_threshold BETWEEN 0 AND 1),
  excluded_apps TEXT NOT NULL,
  capture_retention TEXT NOT NULL,
  notifications INTEGER NOT NULL CHECK(notifications IN (0,1)),
  pill_position TEXT NOT NULL,
  pill_always_on_top INTEGER NOT NULL DEFAULT 1 CHECK(pill_always_on_top IN (0,1)),
  pill_display TEXT NOT NULL DEFAULT 'fees' CHECK(pill_display IN ('fees','time','case')),
  pill_withhold_calls INTEGER NOT NULL DEFAULT 1 CHECK(pill_withhold_calls IN (0,1)),
  invoice_prefix TEXT NOT NULL,
  next_number INTEGER NOT NULL CHECK(next_number>0)
);

-- Work categories.
CREATE TABLE task (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  billable_by_default INTEGER NOT NULL CHECK(billable_by_default IN (0,1)),
  off_screen INTEGER NOT NULL CHECK(off_screen IN (0,1)),
  sort_order INTEGER NOT NULL
);

-- Client identity and billing.
CREATE TABLE client (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE CHECK(code = upper(code) AND length(code)>0),
  type TEXT NOT NULL CHECK(type IN ('individual','company')),
  mode TEXT NOT NULL CHECK(mode IN ('hourly','subscription')),
  rate_cents INTEGER NOT NULL CHECK(rate_cents>=0),
  vat_applicable INTEGER NOT NULL CHECK(vat_applicable IN (0,1)),
  billing_address TEXT NOT NULL
);

-- Client cases and agreed pricing.
CREATE TABLE matter (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES client(id),
  reference TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  case_number TEXT NOT NULL,
  opposing_party TEXT NOT NULL,
  mode TEXT NOT NULL CHECK(mode IN ('hourly','flat_fee')),
  own_rate_cents INTEGER CHECK(own_rate_cents>=0),
  flat_fee_cents INTEGER CHECK(flat_fee_cents>=0),
  hour_cap REAL CHECK(hour_cap>=0),
  success_fee_percent REAL CHECK(success_fee_percent BETWEEN 0 AND 100),
  budget_cents INTEGER CHECK(budget_cents>=0),
  status TEXT NOT NULL CHECK(status IN ('open','closed')),
  opened_on TEXT NOT NULL
);

-- Recognition cues for cases.
CREATE TABLE marker (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matter(id),
  type TEXT NOT NULL CHECK(type IN ('reference','case_number','opposing_party','client_name','file','email','domain','keyword')),
  value TEXT NOT NULL,
  weight REAL NOT NULL CHECK(weight BETWEEN 0 AND 1),
  learned INTEGER NOT NULL CHECK(learned IN (0,1)),
  hits INTEGER NOT NULL DEFAULT 0 CHECK(hits>=0),
  last_seen_at TEXT,
  UNIQUE(matter_id,type,value)
);

-- Client billing rules.
CREATE TABLE client_rule (
  id INTEGER PRIMARY KEY,
  client_id INTEGER NOT NULL REFERENCES client(id),
  type TEXT NOT NULL CHECK(type IN ('daily_research_cap','nonbillable_travel')),
  value INTEGER NOT NULL CHECK(value>=0),
  label TEXT NOT NULL
);

-- Observed activity intervals.
CREATE TABLE block (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  minutes INTEGER NOT NULL CHECK(minutes>=0),
  app TEXT NOT NULL,
  window_title TEXT NOT NULL,
  task_id INTEGER REFERENCES task(id),
  matter_id INTEGER REFERENCES matter(id),
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  state TEXT NOT NULL CHECK(state IN ('assigned','to_check','in_progress','discarded')),
  overlaps_block_id INTEGER REFERENCES block(id)
);

-- Evidence references for blocks.
CREATE TABLE source (
  id INTEGER PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES block(id),
  type TEXT NOT NULL CHECK(type IN ('screen','audio','manual')),
  screenpipe_ref TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  detected_marker TEXT NOT NULL,
  available INTEGER NOT NULL CHECK(available IN (0,1))
);

-- Tracking pauses.
CREATE TABLE pause (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT,
  origin TEXT NOT NULL CHECK(origin IN ('button','automatic')),
  reason TEXT NOT NULL
);

-- Automated review suggestions.
CREATE TABLE jev_review (
  id INTEGER PRIMARY KEY,
  block_id INTEGER NOT NULL REFERENCES block(id),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  probability REAL NOT NULL CHECK(probability BETWEEN 0 AND 1),
  sent_data TEXT NOT NULL
);

-- Issued and draft invoices.
CREATE TABLE invoice (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matter(id),
  number TEXT NOT NULL UNIQUE,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('deposit','final')),
  subtotal_cents INTEGER NOT NULL CHECK(subtotal_cents>=0),
  vat_cents INTEGER NOT NULL CHECK(vat_cents>=0),
  disbursements_cents INTEGER NOT NULL CHECK(disbursements_cents>=0),
  status TEXT NOT NULL CHECK(status IN ('sent','issued'))
);

-- Billable and nonbillable work.
CREATE TABLE time_entry (
  id INTEGER PRIMARY KEY,
  block_id INTEGER REFERENCES block(id),
  matter_id INTEGER REFERENCES matter(id),
  task_id INTEGER NOT NULL REFERENCES task(id),
  date TEXT NOT NULL,
  tenths_of_hour INTEGER NOT NULL CHECK(tenths_of_hour>0),
  label TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  rate_origin TEXT NOT NULL CHECK(rate_origin IN ('base','client','matter','flat_fee')),
  billable INTEGER NOT NULL CHECK(billable IN (0,1)),
  reason TEXT CHECK(reason IN ('offered','internal','admin') OR reason IS NULL),
  review_status TEXT NOT NULL CHECK(review_status IN ('to_review','approved')),
  billing_status TEXT NOT NULL CHECK(billing_status IN ('not_billable','to_bill','billed')),
  invoice_id INTEGER REFERENCES invoice(id)
);

-- Case expenses and disbursements.
CREATE TABLE expense (
  id INTEGER PRIMARY KEY,
  matter_id INTEGER NOT NULL REFERENCES matter(id),
  date TEXT NOT NULL,
  label TEXT NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('expense','disbursement')),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  invoice_id INTEGER REFERENCES invoice(id)
);

-- Frozen invoice details.
CREATE TABLE invoice_line (
  id INTEGER PRIMARY KEY,
  invoice_id INTEGER NOT NULL REFERENCES invoice(id),
  origin TEXT NOT NULL CHECK(origin IN ('time_entry','flat_fee','expense')),
  origin_id INTEGER NOT NULL,
  label TEXT NOT NULL,
  tenths_of_hour INTEGER NOT NULL CHECK(tenths_of_hour>=0),
  rate_cents INTEGER NOT NULL CHECK(rate_cents>=0),
  amount_cents INTEGER NOT NULL CHECK(amount_cents>=0),
  vat INTEGER NOT NULL CHECK(vat IN (0,1))
);

-- Changes and system decisions.
CREATE TABLE audit_event (
  id INTEGER PRIMARY KEY,
  time_entry_id INTEGER REFERENCES time_entry(id) ON DELETE SET NULL,
  block_id INTEGER REFERENCES block(id),
  timestamp TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  before TEXT NOT NULL,
  after TEXT NOT NULL
);

-- Source export receipts.
CREATE TABLE source_export (
  id INTEGER PRIMARY KEY,
  time_entry_ids TEXT NOT NULL,
  options TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Applied schema versions.
CREATE TABLE schema_version (
  version INTEGER PRIMARY KEY,
  applied_on TEXT NOT NULL,
  description TEXT NOT NULL
);

CREATE TRIGGER matter_reference_immutable
BEFORE UPDATE OF reference ON matter
BEGIN
  SELECT RAISE(ABORT, 'Case reference is immutable');
END;

CREATE INDEX idx_block_date ON block(date);
CREATE INDEX idx_block_matter ON block(matter_id);
CREATE INDEX idx_source_block ON source(block_id);
CREATE INDEX idx_time_entry_date ON time_entry(date);
CREATE INDEX idx_time_entry_matter_billing ON time_entry(matter_id,billing_status);
CREATE INDEX idx_invoice_matter ON invoice(matter_id);
CREATE INDEX idx_invoice_line_invoice ON invoice_line(invoice_id);
CREATE INDEX idx_audit_time_entry ON audit_event(time_entry_id);
CREATE INDEX idx_audit_block ON audit_event(block_id);
CREATE INDEX idx_marker_matter ON marker(matter_id);
CREATE INDEX idx_client_rule_client ON client_rule(client_id);
CREATE INDEX idx_expense_matter_invoice ON expense(matter_id,invoice_id);
