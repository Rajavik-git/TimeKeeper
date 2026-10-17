"""Smoke test for the six API-backed screens and the approved navigation."""
import os
from playwright.sync_api import sync_playwright

url = f"http://127.0.0.1:{os.environ.get('UI_PORT', '5173')}/"
expected = [
    ('My day', 'My day'),
    ('Cases', 'Cases'),
    ('Pre-invoices', 'Pre-invoices'),
    ('Source', 'Source'),
    ('Settings', 'Settings'),
    ('Desk pill', 'The TimeKeepr pill'),
]
with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    page.goto(url)
    page.wait_for_load_state('networkidle')
    assert page.get_by_text('Claire Morel').count() > 0
    for tab, heading in expected:
        page.get_by_role('navigation', name='Screens').get_by_role('button', name=tab, exact=False).click()
        page.get_by_role('heading', name=heading, exact=True).wait_for()
        assert not page.locator('.toast').is_visible(), (tab, page.locator('.toast').inner_text())
    page.get_by_role('navigation', name='Screens').get_by_role('button', name='My day', exact=False).click()
    page.get_by_role('group', name='Time entries filter').get_by_role('button', name='Left out').click()
    page.get_by_role('button', name='Count as work').first.wait_for()
    page.get_by_role('group', name='Time entries filter').get_by_role('button', name='All').click()
    row = page.locator('.tbl tbody tr').first
    row.get_by_label('Case').select_option('5')
    row.locator('td').nth(1).get_by_text('Sophie Bernard', exact=False).first.wait_for()
    row.get_by_role('button', name='More actions').click()
    row.get_by_label('Time entry billing').select_option('offered')
    row.locator('.pill').get_by_text('Offered').wait_for()
    entry = next(x for x in page.request.get(f'{url}api/state').json()['time_entry'] if x['id'] == 13)
    assert entry['amount_cents'] == 0 and entry['billing_status'] == 'not_billable'
    page.keyboard.press('2')
    page.get_by_role('heading', name='Cases', exact=True).wait_for()
    page.get_by_role('tab', name='Markers', exact=False).click()
    page.get_by_role('columnheader', name='Weight').wait_for()
    page.keyboard.press('3')
    page.get_by_role('heading', name='Pre-invoices').wait_for()
    assert page.get_by_role('button', name='Approve 2 entries before issuing').is_disabled()
    page.keyboard.press('4')
    page.get_by_role('heading', name='Source', exact=True).wait_for()
    page.locator('.timeline-track button').first.hover()
    page.locator('.preview .num').first.wait_for()
    page.get_by_role('group', name='Theme').get_by_role('button', name='Dark').click()
    assert page.locator('html').get_attribute('data-theme') == 'dark'
    page.get_by_role('group', name='Theme').get_by_role('button', name='Auto').click()
    assert page.locator('html').get_attribute('data-theme') is None
    page.set_viewport_size({'width': 390, 'height': 844})
    for tab, heading in expected:
        page.get_by_role('navigation', name='Screens').get_by_role('button', name=tab, exact=False).click()
        page.get_by_role('heading', name=heading, exact=True).wait_for()
    pill = browser.new_page(viewport={'width': 340, 'height': 490})
    pill.on('pageerror', lambda error: errors.append(str(error)))
    pill.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
    pill.goto(f'{url}pill.html')
    pill.get_by_role('button', name='TimeKeepr, toggle panel').wait_for()
    pill.get_by_text('Paul Dupont').wait_for()
    pill.get_by_role('button', name='TimeKeepr, toggle panel').click()
    pill.get_by_role('button', name='Pause', exact=True).click()
    pill.get_by_role('button', name='Resume', exact=True).wait_for()
    pill.get_by_role('button', name='Resume', exact=True).click()
    pill.get_by_role('button', name='Pause', exact=True).wait_for()
    assert page.request.post(f'{url}api/demo/reset').ok
    assert not errors, errors
    print('Six desktop and phone screens plus the pill, filters, keyboard, source preview, theme and API actions passed; no console errors.')
    browser.close()
