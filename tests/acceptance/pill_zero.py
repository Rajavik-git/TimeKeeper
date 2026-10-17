"""One-click pause, select-to-apply, and guarded undo on the browser pill."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

base=f"http://127.0.0.1:{os.environ.get('UI_PORT','5173')}"
capture_dir=os.environ.get('CAPTURE_DIR')
if capture_dir: Path(capture_dir).mkdir(parents=True,exist_ok=True)
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':420,'height':620})
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    assert page.request.post(f'{base}/api/demo/reset').ok
    page.goto(f'{base}/pill.html?theme=light')
    bar=page.get_by_role('button',name='TimeKeeper, toggle panel')
    bar.wait_for()
    pause=page.get_by_role('button',name='Pause recording')
    if capture_dir: page.screenshot(path=f'{capture_dir}/zero-collapsed.png')
    pause.click()
    resume=page.get_by_role('button',name='Resume recording')
    resume.wait_for()
    if capture_dir: page.screenshot(path=f'{capture_dir}/zero-paused.png')
    assert bar.get_attribute('aria-expanded')=='false'
    assert any(item['end_time'] is None and item['reason'].startswith('Desk pill:') for item in page.request.get(f'{base}/api/state').json()['pause'])
    resume.click()
    pause.wait_for()
    assert not any(item['end_time'] is None and item['reason'].startswith('Desk pill:') for item in page.request.get(f'{base}/api/state').json()['pause'])

    question=page.get_by_role('status',name='Which case')
    question.wait_for()
    question.get_by_label('Choose a case for this period').select_option('5')
    question.wait_for(state='hidden')
    if capture_dir: page.screenshot(path=f'{capture_dir}/zero-confirmed.png')
    assert page.request.get(f'{base}/api/work-periods/13').json()['caseId']=='5'
    page.get_by_role('button',name='Undo last choice').click()
    assert page.request.get(f'{base}/api/work-periods/13').json()['caseId'] is None
    assert any(q['periodId']=='13' and q['status']=='pending' for q in page.request.get(f'{base}/api/questions').json())

    count=len(page.request.get(f'{base}/api/work-periods').json())
    page.get_by_label('Simulate file switch').select_option('2025-031 Opposition Brief v3.docx')
    prompt=page.get_by_role('status',name='File switch suggestion')
    prompt.wait_for()
    prompt.get_by_label('Other case').select_option('2')
    prompt.wait_for(state='hidden')
    assert len(page.request.get(f'{base}/api/work-periods').json())==count+1
    page.get_by_role('button',name='Undo last choice').click()
    assert len(page.request.get(f'{base}/api/work-periods').json())==count
    assert not errors,errors
    browser.close()
print('Collapsed pause/resume, immediate case choices, and undo passed.')
