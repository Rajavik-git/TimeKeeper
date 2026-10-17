"""Smoke the five demo screens, key actions, and fixed landscape shell."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

url = f"http://127.0.0.1:{os.environ.get('UI_PORT', '5173')}/"
capture_dir = os.environ.get('CAPTURE_DIR')
if capture_dir:
    Path(capture_dir).mkdir(parents=True, exist_ok=True)
views = [('My day', 'My day', 'my-day'), ('Cases', 'Cases', 'cases'),
         ('Billing', 'Billing', 'billing'), ('Activity', 'Activity', 'activity'),
         ('Settings', 'Settings', 'settings')]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    assert page.request.post(f'{url}api/demo/reset').ok
    page.goto(url)
    page.wait_for_load_state('networkidle')
    nav = page.get_by_role('navigation', name='Screens')
    assert [x.inner_text().split('\n')[0] for x in nav.locator('button').all()] == [v[0] for v in views]
    for width, height in [(1440, 900), (1280, 800)]:
        page.set_viewport_size({'width': width, 'height': height})
        for theme in ['light', 'dark']:
            page.get_by_role('group', name='Theme').get_by_role('button', name=theme.title()).click()
            for tab, heading, filename in views:
                nav.get_by_role('button', name=tab, exact=False).click()
                page.get_by_role('heading', name=heading, exact=True).first.wait_for()
                geometry = page.evaluate("""() => { const p=document.querySelector('.page'), s=document.querySelector('.shell-main');
                    return {body:document.scrollingElement.scrollHeight,viewport:innerHeight,
                      pageScroll:p.scrollHeight,pageHeight:p.clientHeight,shellScroll:s.scrollHeight,shellHeight:s.clientHeight}; }""")
                assert geometry['body'] <= geometry['viewport']+1, (width,height,theme,tab,geometry)
                assert geometry['pageScroll'] <= geometry['pageHeight']+1, (width,height,theme,tab,geometry)
                assert geometry['shellScroll'] <= geometry['shellHeight']+1, (width,height,theme,tab,geometry)
                if tab == 'My day':
                    assert page.locator('.day-table').evaluate('(el) => el.scrollWidth <= el.clientWidth'), (width,height,theme,'day table horizontal overflow')
                    assert page.get_by_role('columnheader', name='Amount').count()==0
                    assert page.get_by_role('columnheader', name='Status').count()==0
                    assert page.get_by_role('button', name='More actions', exact=False).count()==0
                if capture_dir and width == 1440:
                    page.screenshot(path=f'{capture_dir}/{filename}-{theme}.png')
            nav.get_by_role('button', name='Cases').click()
            page.locator('.client-tile').first.click()
            page.locator('.case-tile').first.click()
            page.get_by_role('tab', name='Markers', exact=False).click()
            assert page.get_by_role('columnheader', name='Weight').count()==0
    page.get_by_role('group', name='Theme').get_by_role('button', name='Auto').click()
    nav.get_by_role('button', name='My day', exact=False).click()
    page.get_by_text('$912.50', exact=True).wait_for()
    page.locator('.datebtn').click()
    page.locator('[data-calendar-day="2026-10-15"]').click()
    page.locator('.ph p').first.get_by_text('Thursday 15 October 2026', exact=False).wait_for()
    nav.get_by_role('button', name='Cases').click()
    client_sort = page.get_by_label('Sort by')
    assert client_sort.input_value() == 'toBill'
    client_sort.select_option('name')
    client_names = page.locator('.client-tile .case-tile-top strong').all_inner_texts()
    assert client_names == sorted(client_names, key=str.casefold), client_names
    nav.get_by_role('button', name='Billing').click()
    nav.get_by_role('button', name='Cases').click()
    assert page.get_by_label('Sort by').input_value() == 'name'
    page.get_by_role('searchbox', name='Search a client or a case').fill('Dawson')
    page.get_by_role('option').first.wait_for()
    nav.get_by_role('button', name='Billing').click()
    page.locator('.billing-card').first.click()
    page.get_by_role('heading', name='What will be on the invoice').wait_for()
    nav.get_by_role('button', name='Activity').click()
    page.get_by_role('heading', name='Timeline').wait_for()
    nav.get_by_role('button', name='Settings').click()
    page.get_by_role('button', name='Desk pill').click()
    page.get_by_role('button', name='Open preview').click()
    page.get_by_role('heading', name='MEMORANDUM OF LAW IN OPPOSITION').wait_for()
    pill = browser.new_page(viewport={'width': 340, 'height': 490})
    pill.on('pageerror', lambda error: errors.append(str(error)))
    pill.goto(f'{url}pill.html')
    pill.get_by_role('button', name='TimeKeeper, toggle panel').wait_for()
    assert page.request.post(f'{url}api/demo/reset').ok
    assert not errors, errors
    print('Five screens, date picker, Clients sort, Cases search, Billing, Activity, Desk preview, 1440×900 and 1280×800 shells passed; no console errors.')
    browser.close()
