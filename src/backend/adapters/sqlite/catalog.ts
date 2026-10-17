import type { DatabaseSync } from 'node:sqlite';

type Row = Record<string, string | number | null>;
const rows = (db:DatabaseSync,table:string) => db.prepare(`SELECT * FROM ${table}`).all() as Row[];
const stamp = () => new Date().toISOString();

/** Keep mockup catalogue edits in the canonical tables within the caller's transaction. */
export function syncDemoCatalog(db:DatabaseSync):void {
  const now=stamp();
  for(const item of rows(db,'client')) db.prepare(`INSERT INTO clients(id,name,active,created_at,updated_at,code,type,mode,hourly_rate_cents,vat_applicable,billing_address)
    VALUES (?,?,1,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at,
    code=excluded.code,type=excluded.type,mode=excluded.mode,hourly_rate_cents=excluded.hourly_rate_cents,
    vat_applicable=excluded.vat_applicable,billing_address=excluded.billing_address`).run(
      String(item.id),item.name,now,now,item.code,item.type,item.mode,item.rate_cents,item.vat_applicable,item.billing_address);
  for(const item of rows(db,'matter')) db.prepare(`INSERT INTO cases(id,client_id,reference,title,hourly_rate_cents,status,created_at,updated_at,
    category,case_number,opposing_party,mode,flat_fee_cents,hour_cap,success_fee_percent,budget_cents,opened_on)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,title=excluded.title,
    hourly_rate_cents=excluded.hourly_rate_cents,status=excluded.status,updated_at=excluded.updated_at,
    category=excluded.category,case_number=excluded.case_number,opposing_party=excluded.opposing_party,
    mode=excluded.mode,flat_fee_cents=excluded.flat_fee_cents,hour_cap=excluded.hour_cap,
    success_fee_percent=excluded.success_fee_percent,budget_cents=excluded.budget_cents,opened_on=excluded.opened_on`).run(
      String(item.id),String(item.client_id),item.reference,item.title,item.own_rate_cents,item.status==='closed'?'archived':'active',now,now,
      item.category,item.case_number,item.opposing_party,item.mode,item.flat_fee_cents,item.hour_cap,item.success_fee_percent,item.budget_cents,item.opened_on);
  const firm=rows(db,'firm')[0],setting=rows(db,'setting')[0];
  if(firm&&setting) db.prepare(`UPDATE settings SET global_hourly_rate_cents=?,lawyer_name=?,address=?,vat_number=?,base_unit=?,vat_rate=?,
    confidence_threshold=?,excluded_apps=?,capture_retention=?,notifications=?,pill_position=?,invoice_prefix=?,next_number=?,updated_at=? WHERE id=1`).run(
      firm.base_rate_cents,firm.lawyer_name,firm.address,firm.vat_number,firm.base_unit,firm.vat_rate,
      setting.confidence_threshold,setting.excluded_apps,setting.capture_retention,setting.notifications,setting.pill_position,
      setting.invoice_prefix,setting.next_number,now);
  for(const item of rows(db,'task')) db.prepare(`INSERT INTO task_types(id,code,label,billable_by_default,off_screen,sort_order)
    VALUES (?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET code=excluded.code,label=excluded.label,
    billable_by_default=excluded.billable_by_default,off_screen=excluded.off_screen,sort_order=excluded.sort_order`).run(
      item.id,item.code,item.label,item.billable_by_default,item.off_screen,item.sort_order);
  db.prepare('DELETE FROM markers WHERE id NOT IN (SELECT id FROM marker)').run();
  for(const item of rows(db,'marker')) db.prepare(`INSERT INTO markers(id,case_id,type,value,weight,learned,hits,last_seen_at)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET case_id=excluded.case_id,type=excluded.type,value=excluded.value,
    weight=excluded.weight,learned=excluded.learned,hits=excluded.hits,last_seen_at=excluded.last_seen_at`).run(
      item.id,String(item.matter_id),item.type,item.value,item.weight,item.learned,item.hits,item.last_seen_at);
  db.prepare('DELETE FROM client_rules WHERE id NOT IN (SELECT id FROM client_rule)').run();
  for(const item of rows(db,'client_rule')) db.prepare(`INSERT INTO client_rules(id,client_id,type,value,label)
    VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id,type=excluded.type,value=excluded.value,label=excluded.label`).run(
      item.id,String(item.client_id),item.type,item.value,item.label);
}
