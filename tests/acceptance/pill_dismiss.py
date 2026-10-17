"""Windows pill notification dismissal and non-document focus regression."""
import os
from playwright.sync_api import sync_playwright

base=f"http://127.0.0.1:{os.environ.get('UI_PORT','5173')}"
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':420,'height':600})
    errors=[]
    page.on('pageerror',lambda error: errors.append(str(error)))
    assert page.request.post(f'{base}/api/demo/reset').ok
    before=len(page.request.get(f'{base}/api/work-periods').json())
    page.goto(f'{base}/pill.html?theme=light')
    bar=page.get_by_role('button',name='TimeKeeper, toggle panel')
    bar.wait_for()
    question=page.get_by_role('status',name='Which case')
    question.wait_for()
    question.get_by_role('button',name='Dismiss').click()
    question.wait_for(state='hidden')
    assert page.get_by_role('status').count()==0
    assert len(page.request.get(f'{base}/api/work-periods').json())==before
    bar.click()
    panel=page.get_by_label('TimeKeeper panel')
    panel.wait_for()
    assert panel.get_by_text('Which case was this?',exact=False).count()>0
    bar.click()
    panel.wait_for(state='hidden')

    selector=page.get_by_label('Simulate file switch')
    selector.select_option('2025-031 Opposition Brief v3.docx')
    prompt=page.get_by_role('status',name='File switch suggestion')
    prompt.wait_for()
    prompt.get_by_role('button',name='Later').click()
    prompt.wait_for(state='hidden')
    selector.select_option('2026-015 Memo on right of first refusal.docx')
    prompt.wait_for()
    page.keyboard.press('Escape')
    prompt.wait_for(state='hidden')
    selector.select_option('Program Manager')
    page.wait_for_timeout(300)
    assert page.get_by_role('status').count()==0
    assert len(page.request.get(f'{base}/api/work-periods').json())==before

    selector.select_option('Meeting request - new matter.eml')
    prompt.wait_for()
    assert prompt.get_by_role('button',name='Confirm').is_disabled()
    assert prompt.get_by_role('button',name='Confirm').evaluate('(el) => getComputedStyle(el).opacity')=='1'
    assert prompt.get_by_label('Other case').input_value()==''
    assert prompt.get_by_label('Other case').locator('option').first.inner_text()=='Choose a case…'
    assert prompt.get_by_role('button',name='Use case').count()==0
    prompt.get_by_label('Other case').select_option('1')
    prompt.wait_for(state='hidden')
    page.get_by_role('button',name='Undo last choice').click()
    page.get_by_text('Choice undone').wait_for()
    assert len(page.request.get(f'{base}/api/work-periods').json())==before

    selector.select_option('2025-031 Opposition Brief v3.docx')
    prompt.wait_for()
    prompt.get_by_role('button',name='Confirm',exact=False).click()
    prompt.wait_for(state='hidden')
    assert page.get_by_role('status',name='New work period').count()==0
    assert page.get_by_role('status').count()==0
    after=page.request.get(f'{base}/api/work-periods').json()
    assert len(after)==before+1
    assert any(period.get('demoWindowTitle')=='2025-031 Opposition Brief v3.docx' and not period.get('timeValidated') for period in after)
    assert not errors,errors
    browser.close()
print('Pill dismiss X/Later/Escape/bar, unreadable no-suggestion prompt, and unchanged pending periods passed.')
