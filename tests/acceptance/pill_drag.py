"""Move, restore, and reset the standalone browser pill without affecting its actions."""
import os
from playwright.sync_api import sync_playwright

base=f"http://127.0.0.1:{os.environ.get('UI_PORT','5173')}"
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1280,'height':800})
    assert page.request.post(f'{base}/api/demo/reset').ok
    page.goto(f'{base}/pill.html?theme=light')
    page.evaluate("localStorage.removeItem('timekeeper:pill-position')")
    page.reload()
    grip=page.get_by_role('button',name='Move pill')
    grip.wait_for()
    page.get_by_role('button',name='Pause recording').wait_for()
    bar=page.locator('.pill-bar')
    initial=bar.bounding_box()
    point=grip.bounding_box()
    page.mouse.move(point['x']+point['width']/2,point['y']+point['height']/2)
    page.mouse.down()
    page.mouse.move(point['x']+point['width']/2+170,point['y']+point['height']/2+130,steps=8)
    page.mouse.up()
    moved=bar.bounding_box()
    assert moved['x']>initial['x']+120 and moved['y']>initial['y']+100,(initial,moved)
    page.reload()
    grip.wait_for()
    restored=bar.bounding_box()
    assert abs(restored['x']-moved['x'])<3 and abs(restored['y']-moved['y'])<3,(moved,restored)
    page.get_by_role('button',name='TimeKeeper, toggle panel').click()
    panel=page.get_by_label('TimeKeeper panel')
    if not panel.is_visible(): page.get_by_role('button',name='TimeKeeper, toggle panel').click()
    panel.wait_for()
    assert panel.bounding_box()['y']>=bar.bounding_box()['y']+37
    point=grip.bounding_box()
    page.mouse.move(point['x']+point['width']/2,point['y']+point['height']/2)
    page.mouse.down()
    page.mouse.move(1260,770,steps=10)
    page.mouse.up()
    assert panel.bounding_box()['y']+panel.bounding_box()['height']<bar.bounding_box()['y']
    assert panel.bounding_box()['x']>=0 and panel.bounding_box()['x']+panel.bounding_box()['width']<=1280
    page.get_by_role('button',name='TimeKeeper, toggle panel').click()
    grip.focus()
    edge=bar.bounding_box()
    page.keyboard.press('Alt+ArrowLeft')
    assert bar.bounding_box()['x']<=edge['x']-18
    page.keyboard.press('Alt+Home')
    assert abs(bar.bounding_box()['x']-initial['x'])<3
    point=grip.bounding_box()
    page.mouse.dblclick(point['x']+point['width']/2,point['y']+point['height']/2)
    assert abs(bar.bounding_box()['x']-initial['x'])<3
    glass=bar.evaluate("node=>getComputedStyle(node).backgroundColor")
    assert glass=='rgba(250, 250, 251, 0.94)',glass
    browser.close()
print('Browser pill drag, restore, adjacent panel, keyboard movement, reset, and opacity passed.')
