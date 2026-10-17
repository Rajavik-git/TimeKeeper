"""Exercise the browser pill's document-switch flow against a running demo API."""
import os
import re
from pathlib import Path
from playwright.sync_api import sync_playwright

base = f"http://127.0.0.1:{os.environ.get('UI_PORT', '5173')}"
capture_dir = os.environ.get("CAPTURE_DIR")
if capture_dir:
    Path(capture_dir).mkdir(parents=True, exist_ok=True)
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda error: errors.append(str(error)))
    assert page.request.post(f"{base}/api/demo/reset").ok
    page.goto(f"{base}/pill.html?theme=light")
    page.get_by_role("button", name="TimeKeeper, toggle panel").wait_for()
    page.get_by_label("Simulate file switch").select_option("2025-031 Opposition Brief v3.docx")
    prompt = page.get_by_role("status", name="File switch suggestion")
    prompt.get_by_text("Dawson v Martin?", exact=False).wait_for()
    assert re.search(r"Confirm · \d+s", prompt.inner_text())
    if capture_dir:
        page.wait_for_timeout(220)
        page.screenshot(path=f"{capture_dir}/pill-switch-light.png")
    prompt.get_by_role("button", name="Confirm", exact=False).click()
    prompt.wait_for(state="hidden")
    periods = page.request.get(f"{base}/api/work-periods?date=2026-10-16").json()
    switched = [period for period in periods if period.get("demoWindowTitle") == "2025-031 Opposition Brief v3.docx"
                and period.get("demoApp") == "Demo documents" and period.get("endedAt") is None]
    assert len(switched) == 1, switched
    assert switched[0]["caseId"] == "1"
    if capture_dir:
        page.get_by_role("button", name="TimeKeeper, toggle panel").click()
        page.get_by_label("TimeKeeper panel").wait_for()
        page.wait_for_timeout(220)
        page.screenshot(path=f"{capture_dir}/pill-panel-light.png")
    page.goto(base)
    page.get_by_role("heading", name="My day", exact=True).wait_for()
    row = page.locator(".day-table tbody tr").filter(has_text="Demo documents").filter(has_text="Dawson v Martin")
    row.wait_for()
    assert row.count() == 1
    page.goto(f"{base}/pill.html?theme=light")
    page.get_by_label("Simulate file switch").select_option(
        "Research - notice of appeal deadline for family court orders.docx")
    low = page.get_by_role("status", name="File switch suggestion")
    low.wait_for()
    assert "Divorce" in low.inner_text()
    assert not re.search(r"Confirm · \d+s", low.inner_text())
    if capture_dir:
        page.goto(f"{base}/pill.html?theme=dark")
        page.get_by_role("button", name="TimeKeeper, toggle panel").click()
        page.get_by_label("TimeKeeper panel").wait_for()
        page.wait_for_timeout(220)
        page.screenshot(path=f"{capture_dir}/pill-panel-dark.png")
    page.goto(f"{base}/pill.html?theme=light")
    question = page.get_by_role("status", name="Which case")
    question.wait_for()
    question.get_by_label("Choose a case for this period").select_option("5")
    question.get_by_role("button", name="Answer").click()
    question.wait_for(state="hidden")
    answered = page.request.get(f"{base}/api/work-periods/13").json()
    assert answered["caseId"] == "5", answered
    assert not errors, errors
    browser.close()
print("Pill file-switch confirmation, My day period, and low-confidence research prompt passed.")
