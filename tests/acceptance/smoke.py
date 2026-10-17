"""Smoke the six demo screens, Cases hierarchy, floating pill and fixed landscape shell."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

url = f"http://127.0.0.1:{os.environ.get('UI_PORT', '5173')}/"
capture_dir = os.environ.get('CAPTURE_DIR')
if capture_dir:
    Path(capture_dir).mkdir(parents=True, exist_ok=True)
views = [
    ('My day', 'My day', 'my-day'),
    ('Cases', 'Cases', 'cases'),
    ('Pre-invoices', 'Pre-invoices', 'pre-invoices'),
    ('Source', 'Source', 'source'),
    ('Settings', 'Settings', 'settings'),
    ('Desk pill', 'The TimeKeeper pill', 'desk-pill'),
]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    assert page.request.post(f'{url}api/demo/reset').ok
    page.goto(url)
    page.wait_for_load_state('networkidle')
    assert page.locator('.brand-wordmark').inner_text() == 'TimeKeeper'
    assert page.locator('.floating-nav').is_visible()
    assert page.locator('.shell-side').count() == 0
    for width, height in [(1440, 900), (1280, 800)]:
        page.set_viewport_size({'width': width, 'height': height})
        for theme in ['light', 'dark']:
            page.get_by_role('group', name='Theme').get_by_role('button', name=theme.title()).click()
            for tab, heading, filename in views:
                page.get_by_role('navigation', name='Screens').get_by_role('button', name=tab, exact=False).click()
                page.get_by_role('heading', name=heading, exact=True).wait_for()
                assert not page.locator('.toast').is_visible(), (tab, page.locator('.toast').inner_text())
                size = page.evaluate('({scroll:document.scrollingElement.scrollHeight, height:innerHeight})')
                assert size['scroll'] <= size['height'], (width, height, theme, tab, size)
                too_small = page.evaluate("""() => [...document.querySelectorAll('body *')]
                    .filter(el => el.children.length === 0 && el.textContent?.trim() && el.getClientRects().length
                        && getComputedStyle(el).visibility !== 'hidden'
                        && parseFloat(getComputedStyle(el).fontSize) > 0
                        && parseFloat(getComputedStyle(el).fontSize) < 12.5)
                    .map(el => [el.className, el.textContent.trim().slice(0, 30)])""")
                assert not too_small, (width, height, theme, tab, too_small)
                if tab == 'My day':
                    assert page.locator('.day-table').evaluate('(el) => el.scrollWidth <= el.clientWidth'), (width, height, theme, 'horizontal day table overflow')
                if capture_dir and width == 1440:
                    page.screenshot(path=f'{capture_dir}/{filename}-{theme}.png')
            page.get_by_role('navigation', name='Screens').get_by_role('button', name='Cases', exact=False).click()
            page.locator('.client-tile').first.click()
            assert page.get_by_role('navigation', name='Case breadcrumb').get_by_role('button', name='Cases').count() == 1
            if capture_dir and width == 1440:
                page.screenshot(path=f'{capture_dir}/cases-client-{theme}.png')
            page.locator('.case-tile').first.click()
            if capture_dir and width == 1440:
                page.screenshot(path=f'{capture_dir}/cases-detail-{theme}.png')
            page.get_by_role('tab', name='Markers', exact=False).click()
            page.get_by_role('columnheader', name='Weight').wait_for()
            page.get_by_role('navigation', name='Case breadcrumb').get_by_role('button', name='Cases').click()
    page.get_by_role('group', name='Theme').get_by_role('button', name='Auto').click()
    page.get_by_role('navigation', name='Screens').get_by_role('button', name='My day', exact=False).click()
    page.get_by_role('heading', name='Which case was this?').wait_for()
    page.get_by_role('heading', name='Your day is ready.').wait_for()
    page.get_by_text('4h 27m', exact=True).wait_for()
    page.get_by_text('€912.50', exact=True).wait_for()
    page.get_by_text('11:24–12:05', exact=False).first.wait_for()
    page.get_by_role('group', name='Work periods filter').get_by_role('button', name='Left out').click()
    page.get_by_role('button', name='Count as work').first.wait_for()
    page.get_by_role('group', name='Work periods filter').get_by_role('button', name='All').click()
    page.get_by_role('button', name='More actions for Drafting response submissions on termination of exclusivity').click()
    page.get_by_role('button', name='Correct duration').wait_for()
    page.get_by_role('button', name='More actions for Drafting response submissions on termination of exclusivity').click()
    page.get_by_role('button', name='Validate the 4 recognized periods').click()
    page.wait_for_function("document.querySelectorAll('.grid4 .kpi .v')[3]?.textContent === '1'")
    page.keyboard.press('4')
    page.get_by_role('heading', name='Source', exact=True).wait_for()
    page.locator('.timeline-track button').first.hover()
    page.locator('.preview .num').first.wait_for()
    page.get_by_text('Source validated', exact=False).first.wait_for()
    page.set_viewport_size({'width': 390, 'height': 844})
    for tab, heading, _ in views:
        page.get_by_role('navigation', name='Screens').get_by_role('button', name=tab, exact=False).click()
        page.get_by_role('heading', name=heading, exact=True).wait_for()
    pill = browser.new_page(viewport={'width': 340, 'height': 490})
    pill.on('pageerror', lambda error: errors.append(str(error)))
    pill.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    pill.goto(f'{url}pill.html')
    pill.get_by_role('button', name='TimeKeeper, toggle panel').wait_for()
    pill.get_by_text('Session active').wait_for()
    pill.get_by_role('button', name='TimeKeeper, toggle panel').click()
    pill.get_by_text('Session since', exact=False).wait_for()
    pill.get_by_text('No current case').wait_for()
    assert pill.get_by_role('button', name='Pause', exact=True).is_disabled()
    assert page.request.post(f'{url}api/demo/reset').ok
    assert not errors, errors
    print('Six screens, Cases hierarchy, 1440×900 and 1280×800 page height, phone, pill, totals, source preview and theme passed; no console errors.')
    browser.close()
