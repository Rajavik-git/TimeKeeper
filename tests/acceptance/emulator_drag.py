"""Keep the draggable pill inside the simulated desktop and restore its placement."""
import os
from playwright.sync_api import sync_playwright

base=f"http://127.0.0.1:{os.environ.get('UI_PORT','5173')}"
with sync_playwright() as playwright:
    browser=playwright.chromium.launch(headless=True)
    page=browser.new_page(viewport={'width':1440,'height':900})
    assert page.request.post(f'{base}/api/demo/reset').ok
    page.goto(base)
    page.evaluate("localStorage.removeItem('timekeeper:emulator-pill-position')")
    page.reload()
    page.get_by_role('navigation',name='Screens').get_by_role('button',name='Desktop').click()
    frame=page.locator('iframe[title="TimeKeeper desk pill"]')
    pill=page.frame_locator('iframe[title="TimeKeeper desk pill"]')
    grip=pill.get_by_role('button',name='Move pill')
    grip.wait_for()
    initial=frame.bounding_box()
    handle=page.evaluate("""() => {const frame=document.querySelector('.em-pill-frame'),outer=frame.getBoundingClientRect();
      const grip=frame.contentDocument.querySelector('.pill-drag').getBoundingClientRect();
      return {x:outer.x+(grip.x+grip.width/2)*outer.width/frame.clientWidth,
        y:outer.y+(grip.y+grip.height/2)*outer.height/frame.clientHeight};}""")
    page.mouse.move(handle['x'],handle['y'])
    page.mouse.down()
    page.mouse.move(handle['x']+180,handle['y']+130,steps=8)
    page.mouse.up()
    page.wait_for_timeout(150)
    moved=frame.bounding_box()
    assert moved['x']>initial['x']+100 and moved['y']>initial['y']+80,(initial,moved)
    page.reload()
    page.get_by_role('navigation',name='Screens').get_by_role('button',name='Desktop').click()
    frame.wait_for()
    restored=frame.bounding_box()
    assert abs(restored['x']-moved['x'])<5 and abs(restored['y']-moved['y'])<5,(moved,restored)
    grip=pill.get_by_role('button',name='Move pill')
    grip.focus()
    assert grip.evaluate('(node) => node.ownerDocument.activeElement === node')
    grip.press('Alt+ArrowRight')
    page.wait_for_function("x => document.querySelector('.em-pill-frame').getBoundingClientRect().x >= x + 15",arg=restored['x'])
    grip.press('Alt+Home')
    page.wait_for_function("x => Math.abs(document.querySelector('.em-pill-frame').getBoundingClientRect().x - x) < 5",arg=initial['x'])
    pill.get_by_role('status',name='Which case').wait_for()
    handle=page.evaluate("""() => {const frame=document.querySelector('.em-pill-frame'),outer=frame.getBoundingClientRect();
      const grip=frame.contentDocument.querySelector('.pill-drag').getBoundingClientRect();
      return {x:outer.x+(grip.x+grip.width/2)*outer.width/frame.clientWidth,
        y:outer.y+(grip.y+grip.height/2)*outer.height/frame.clientHeight};}""")
    page.mouse.move(handle['x'],handle['y'])
    page.mouse.down()
    page.mouse.move(1260,760,steps=12)
    page.mouse.up()
    page.wait_for_function("() => document.querySelector('.em-pill-frame').contentDocument.querySelector('.pill-root').classList.contains('native-above')")
    bounds=page.get_by_role('region',name='Windows desktop emulator').bounding_box()
    popup=pill.get_by_role('status',name='Which case').bounding_box()
    assert popup['y']>=bounds['y'] and popup['y']+popup['height']<bounds['y']+bounds['height']-53
    handle=page.evaluate("""() => {const frame=document.querySelector('.em-pill-frame'),outer=frame.getBoundingClientRect();
      const grip=frame.contentDocument.querySelector('.pill-drag').getBoundingClientRect();
      return {x:outer.x+(grip.x+grip.width/2)*outer.width/frame.clientWidth,
        y:outer.y+(grip.y+grip.height/2)*outer.height/frame.clientHeight};}""")
    page.mouse.dblclick(handle['x'],handle['y'])
    page.wait_for_function("x => Math.abs(document.querySelector('.em-pill-frame').getBoundingClientRect().x - x) < 5",arg=initial['x'])
    browser.close()
print('Emulator pill drag, persistence, keyboard movement, and reset passed.')
