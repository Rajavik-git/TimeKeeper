"""Exercise the Vercel desktop emulator and its live pill/API switch flow."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

base = f"http://127.0.0.1:{os.environ.get('UI_PORT', '5173')}"
captures = Path(os.environ.get('CAPTURE_DIR', 'captures'))
captures.mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width':1440,'height':900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    assert page.request.post(f'{base}/api/demo/reset').ok
    page.goto(base)
    page.wait_for_load_state('networkidle')
    page.get_by_role('navigation',name='Screens').get_by_role('button',name='Desktop').click()
    desktop = page.get_by_role('region',name='Windows desktop emulator')
    desktop.wait_for()
    pill = page.frame_locator('iframe[title="TimeKeeper desk pill"]')
    pill.get_by_role('button',name='TimeKeeper, toggle panel').wait_for()
    for width,height in [(1440,900),(1366,640)]:
        page.set_viewport_size({'width':width,'height':height})
        page.wait_for_timeout(150)
        geometry=page.evaluate("""() => ({body:document.scrollingElement.scrollHeight,viewport:innerHeight,
          page:document.querySelector('.page').scrollHeight,pageHeight:document.querySelector('.page').clientHeight,
          desktop:document.querySelector('.em-desktop').getBoundingClientRect().height})""")
        assert geometry['body'] <= geometry['viewport']+1, geometry
        assert geometry['page'] <= geometry['pageHeight']+1, geometry
        assert geometry['desktop'] > 350, geometry
        page.screenshot(path=str(captures/f'emulator-{width}x{height}.png'))
    page.set_viewport_size({'width':1440,'height':900})
    page.locator('.em-file-row').filter(has_text='2025-031 Engagement letter - Paul Dawson.pdf').dblclick()
    page.get_by_role('region',name='2025-031 Engagement letter - Paul Dawson.pdf - Acrobat').wait_for()
    page.get_by_role('button',name='Open the Dawson brief').click()
    page.get_by_role('region',name='2025-031 Opposition Brief v3.docx - Word').wait_for()
    prompt = pill.get_by_role('status',name='File switch suggestion')
    prompt.get_by_text('Dawson v Martin?',exact=False).wait_for(timeout=10000)
    page.screenshot(path=str(captures/'emulator-brief-prompt.png'))
    prompt.get_by_role('button',name='Confirm',exact=False).click()
    prompt.wait_for(state='hidden')
    periods=page.request.get(f'{base}/api/work-periods?date=2026-10-16').json()
    assert any(period.get('caseId')=='1' and period.get('demoApp')=='Word' and
      period.get('demoWindowTitle')=='2025-031 Opposition Brief v3.docx - Word' for period in periods), periods
    page.get_by_role('button',name='Switch to the Lumen memo').click()
    lumen=pill.get_by_role('status',name='File switch suggestion')
    lumen.wait_for(timeout=10000)
    assert 'Shareholders agreement' in lumen.inner_text()
    lumen.get_by_role('button',name='Confirm',exact=False).click()
    lumen.wait_for(state='hidden')
    page.get_by_role('button',name='Open the research note').click()
    low=pill.get_by_role('status',name='File switch suggestion')
    low.wait_for(timeout=10000)
    assert 'Divorce' in low.inner_text()
    assert 'Confirm ·' not in low.inner_text()
    page.screenshot(path=str(captures/'emulator-research-prompt.png'))
    page.get_by_role('button',name='Open TimeKeeper and validate').click()
    app=page.frame_locator('iframe[title="TimeKeeper inside the desktop"]')
    app.get_by_role('heading',name='My day',exact=True).wait_for()
    assert app.get_by_role('navigation',name='Screens').get_by_role('button',name='Desktop').count()==0
    app.locator('body').press('6')
    assert app.get_by_role('region',name='Windows desktop emulator').count()==0
    assert app.locator('.day-table tbody tr').filter(has_text='Dawson v Martin').count()>=1
    page.screenshot(path=str(captures/'emulator-app-window.png'))
    window=page.get_by_role('region',name='TimeKeeper app')
    before=window.bounding_box()
    page.mouse.move(before['x']+35,before['y']+18)
    page.mouse.down()
    page.mouse.move(before['x']+73,before['y']+50,steps=4)
    page.mouse.up()
    assert window.bounding_box()['x'] > before['x']+20
    moved=window.bounding_box()
    page.mouse.move(moved['x']+35,moved['y']+18)
    page.mouse.down()
    page.mouse.move(3000,2000,steps=4)
    page.mouse.up()
    limits=desktop.bounding_box()
    bounded=window.bounding_box()
    assert bounded['x']+bounded['width'] <= limits['x']+limits['width']+1
    assert bounded['y']+bounded['height'] <= limits['y']+limits['height']-40
    window.get_by_role('button',name='Minimize window').click()
    window.wait_for(state='hidden')
    page.locator('.em-task-open button[title="timekeeper"]').click()
    window.wait_for()
    window.get_by_role('button',name='Close window').click()
    window.wait_for(state='hidden')
    page.get_by_role('group',name='Theme').get_by_role('button',name='Dark').click()
    page.wait_for_function("() => { const root=document.querySelector('.em-pill-frame').contentDocument.documentElement; return root.dataset.theme==='dark' && getComputedStyle(root).getPropertyValue('--glass').includes('20,20,23'); }")
    page.get_by_role('group',name='Theme').get_by_role('button',name='Light').click()
    assert not errors, errors
    browser.close()
print('Desktop emulator, pill recognition, canonical switch, and embedded app passed.')
