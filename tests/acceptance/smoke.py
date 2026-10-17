"""Smoke the five demo screens, key actions, and fixed landscape shell."""
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

url = f"http://{os.environ.get('UI_HOST', '127.0.0.1')}:{os.environ.get('UI_PORT', '5173')}/"
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
                    page.locator('.day-table').wait_for()
                    actions_header = page.get_by_role('columnheader', name='Actions')
                    assert actions_header.count() == 1
                    assert actions_header.evaluate('(el) => getComputedStyle(el).textAlign') == 'right'
                    header_styles = page.locator('.day-table th').first.evaluate('(el) => { const s=getComputedStyle(el); return [s.backgroundColor,s.color]; }')
                    assert header_styles == (['rgb(228, 228, 231)','rgb(63, 63, 70)'] if theme == 'light' else ['rgb(17, 17, 19)','rgb(212, 212, 216)']), (theme,header_styles)
                    assert page.locator('.day-periods .tbl').evaluate("(el) => getComputedStyle(el, '::-webkit-scrollbar').width") == '6px'
                    palette = page.evaluate("""() => { const css=getComputedStyle(document.documentElement);
                        return Object.fromEntries(['--act','--act-ink','--ok-dot','--ok','--warn-dot','--warn','--bad','--sum-up','--sum-down'].map(key=>[key,css.getPropertyValue(key).trim().toLowerCase()])); }""")
                    expected = ({'--act':'#2b3a4f','--act-ink':'#f2f5f9','--ok-dot':'#4f7a5e','--ok':'#3f6b50','--warn-dot':'#a8894f','--warn':'#7a6230','--bad':'#8e3b3b','--sum-up':'#9cc3a8','--sum-down':'#e2a3a3'} if theme == 'light' else
                                {'--act':'#93a5bf','--act-ink':'#0c0c0d','--ok-dot':'#7fa98d','--ok':'#7fa98d','--warn-dot':'#c9ae7a','--warn':'#c9ae7a','--bad':'#c77474','--sum-up':'#2f5e40','--sum-down':'#7a2c2c'})
                    assert palette == expected, (theme, palette)
                    assert page.locator('.btn.attn svg').count() == 0
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
    assert page.locator('.datebadge').inner_text() == '1'
    assert page.locator('.datebadge').get_attribute('title') == '1 other day with periods to validate (15 Oct)'
    page.locator('.datebtn').click()
    assert page.locator('[data-calendar-day="2026-10-15"] i.p').count() == 1
    assert page.locator('[data-calendar-day="2026-10-14"] i:not(.p)').count() == 1
    assert 'off' in (page.locator('[data-calendar-day="2026-10-01"]').get_attribute('class') or '')
    assert page.locator('[data-calendar-day="2026-10-01"]').is_enabled()
    assert page.locator('[data-calendar-day="2026-10-17"]').is_disabled()
    assert page.get_by_text('Hatched: no recording', exact=True).count() == 1
    page.locator('[data-calendar-day="2026-10-01"]').click()
    page.locator('.day-periods .empty b').get_by_text('No work recorded').wait_for()
    assert page.locator('.datebadge').inner_text() == '2'
    page.locator('.datebtn').click()
    page.locator('[data-calendar-day="2026-10-15"]').click()
    page.locator('.ph p').first.get_by_text('Thursday, 15 October 2026', exact=False).wait_for()
    nav.get_by_role('button', name='Cases').click()
    client_sort = page.get_by_label('Sort by')
    assert client_sort.input_value() == 'toBill'
    client_sort.select_option('name')
    client_names = page.locator('.client-tile .case-tile-top strong').all_inner_texts()
    assert client_names == sorted(client_names, key=str.casefold), client_names
    nav.get_by_role('button', name='Billing').click()
    nav.get_by_role('button', name='Cases').click()
    assert page.get_by_label('Sort by').input_value() == 'name'
    first_billing_client = page.locator('.bill-client-group').first
    expand = first_billing_client.locator('.bill-expand')
    assert expand.get_attribute('aria-expanded') == 'false'
    expand.click()
    assert expand.get_attribute('aria-expanded') == 'true'
    assert page.get_by_role('heading', name='Cases', exact=True).is_visible()
    assert first_billing_client.locator('.bill-case-row').first.is_visible()
    assert first_billing_client.locator('.bill-case-row .bar').first.evaluate('(el) => el.getBoundingClientRect().height') < first_billing_client.locator('.bill-client-link .bar').evaluate('(el) => el.getBoundingClientRect().height')
    expand.click()
    assert expand.get_attribute('aria-expanded') == 'false'
    assert not first_billing_client.locator('.bill-case-row').first.is_visible()
    first_billing_client.locator('.bill-client-link').click()
    assert page.get_by_role('navigation', name='Case breadcrumb').is_visible()
    page.get_by_role('navigation', name='Case breadcrumb').get_by_role('button', name='Cases').click()
    page.locator('.bill-client-group').first.locator('.bill-expand').click()
    page.locator('.bill-client-group').first.locator('.bill-case-row').first.click()
    assert page.get_by_role('button', name='Export source pack').is_visible()
    page.get_by_role('navigation', name='Case breadcrumb').get_by_role('button', name='Cases').click()
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
    print('Five screens, final palette, calendar, table headers and scrollbars, Clients sort, expandable billing cases, Cases search, Billing, Activity, Desk preview, 1440×900 and 1280×800 shells passed; no console errors.')
    browser.close()
