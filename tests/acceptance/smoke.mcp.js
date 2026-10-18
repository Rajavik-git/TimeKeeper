/* global document, getComputedStyle, innerHeight */
// eslint-disable-next-line no-unused-vars -- Playwright MCP loads and invokes this function.
async function smoke(page) {
  const url = new URL("/", page.url()).href;
  const errors = [];
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const onPageError = (error) => errors.push(String(error));
  const onConsole = (message) => {
    if (message.type() === "error") errors.push(message.text());
  };
  const views = ["My day", "Cases", "Billing", "Activity", "Settings"];
  const viewports = [
    { width: 1440, height: 900 },
    { width: 1280, height: 800 },
  ];
  const themes = ["light", "dark"];
  // Set an absolute directory here to retain the ten 1440×900 theme screenshots.
  const captureDir = null;
  const screenshots = [];
  let pill;
  page.on("pageerror", onPageError);
  page.on("console", onConsole);
  try {
    // Keep calendar assertions stable while the app uses the actual local date.
    await page.clock.install({ time: new Date("2026-10-17T12:00:00") });
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    await page.getByRole("heading", { name: "My day", exact: true }).waitFor();
    const nav = page.getByRole("navigation", { name: "Screens" });
    const labels = (await nav.locator("button").allInnerTexts()).map((text) => text.split("\n")[0]);
    check(JSON.stringify(labels) === JSON.stringify(views), "Unexpected navigation tabs");
    const openView = async (name) => {
      await nav.getByRole("button", { name, exact: false }).click();
      await page.getByRole("heading", { name, exact: true }).first().waitFor();
      if (name === "My day") {
        await page.locator(".datebtn").click();
        await page.getByRole("combobox", { name: "Year", exact: true }).selectOption("2026");
        await page.getByRole("combobox", { name: "Month", exact: true }).selectOption("9");
        await page.locator('[data-calendar-day="2026-10-16"]').click();
        await page
          .getByText("Incomplete estimate · $882.50 known; some pricing is unavailable", {
            exact: true,
          })
          .waitFor();
      }
    };
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      for (const theme of themes) {
        await page
          .getByRole("group", { name: "Theme" })
          .getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true })
          .click();
        for (const view of views) {
          await openView(view);
          const geometry = await page.evaluate(() => {
            const content = document.querySelector(".page");
            const shell = document.querySelector(".shell-main");
            return {
              body: document.scrollingElement.scrollHeight,
              viewport: innerHeight,
              pageScroll: content.scrollHeight,
              pageHeight: content.clientHeight,
              shellScroll: shell.scrollHeight,
              shellHeight: shell.clientHeight,
              zoom: getComputedStyle(document.documentElement).zoom,
            };
          });
          check(
            geometry.body <= geometry.viewport + 1 &&
              geometry.pageScroll <= geometry.pageHeight + 1 &&
              geometry.shellScroll <= geometry.shellHeight + 1,
            `Overflow in ${view}, ${theme}, ${viewport.width}×${viewport.height}: ${JSON.stringify(geometry)}`,
          );
          check(Number(geometry.zoom) === 1, "The application must not shrink the document");
          const controlsFit = await page
            .locator(".btn, .input, .field, .select, .iconbtn")
            .evaluateAll((controls) =>
              controls
                .filter((control) => control.getClientRects().length)
                .every(
                  (control) =>
                    Math.abs(
                      control.getBoundingClientRect().height -
                        (control.matches(".sm, .small") ? 32 : 38),
                    ) < 0.5,
                ),
            );
          check(controlsFit, `Shared controls changed size in ${view}`);
          if (view === "Cases") {
            const cardsFit = await page.locator(".client-grid").evaluate((grid) => {
              const name = grid.querySelector(".client-tile strong");
              if (!name) return true;
              const original = name.textContent;
              try {
                name.textContent = "A deliberately long client organisation name ".repeat(5);
                const cards = [...grid.querySelectorAll(".client-tile")];
                return cards.every((card, index) => {
                  const bounds = card.getBoundingClientRect();
                  const facts = card.querySelector(".case-tile-facts").getBoundingClientRect();
                  return (
                    facts.bottom <= bounds.bottom + 1 &&
                    cards.slice(index + 1).every((neighbor) => {
                      const other = neighbor.getBoundingClientRect();
                      return (
                        bounds.right <= other.left ||
                        other.right <= bounds.left ||
                        bounds.bottom <= other.top ||
                        other.bottom <= bounds.top
                      );
                    })
                  );
                });
              } finally {
                name.textContent = original;
              }
            });
            check(cardsFit, "Long client cards must contain their facts and not overlap");
          }
          if (view === "Settings") {
            await page.getByRole("button", { name: "Rates", exact: true }).click();
            const reachable = await page.locator(".settings-content").evaluate((content) => {
              content.scrollTop = content.scrollHeight;
              const last = [...content.querySelectorAll("input")]
                .filter((input) => input.getClientRects().length)
                .at(-1);
              const bounds = content.getBoundingClientRect();
              return !last || last.getBoundingClientRect().bottom <= bounds.bottom + 1;
            });
            check(reachable, "The last rate control must be reachable by scrolling");
            await page.getByRole("button", { name: "Clients", exact: true }).click();
          }
          if (view === "My day") {
            await page.locator(".day-table").waitFor();
            const actions = page.getByRole("columnheader", { name: "Actions", exact: true });
            check((await actions.count()) === 1, "Expected one Actions header");
            check(
              (await actions.evaluate((el) => getComputedStyle(el).textAlign)) === "right",
              "Actions header must be right aligned",
            );
            const headerStyles = await page
              .locator(".day-table th")
              .first()
              .evaluate((el) => {
                const styles = getComputedStyle(el);
                return [styles.backgroundColor, styles.color];
              });
            const expectedHeader =
              theme === "light"
                ? ["rgb(228, 228, 231)", "rgb(63, 63, 70)"]
                : ["rgb(17, 17, 19)", "rgb(212, 212, 216)"];
            check(
              JSON.stringify(headerStyles) === JSON.stringify(expectedHeader),
              `Unexpected ${theme} table header`,
            );
            check(
              (await page
                .locator(".day-periods .tbl")
                .evaluate((el) => getComputedStyle(el, "::-webkit-scrollbar").width)) === "6px",
              "Expected 6px scrollbar",
            );
            const palette = await page.evaluate(() => {
              const styles = getComputedStyle(document.documentElement);
              return Object.fromEntries(
                [
                  "--act",
                  "--act-ink",
                  "--ok-dot",
                  "--ok",
                  "--warn-dot",
                  "--warn",
                  "--bad",
                  "--sum-up",
                  "--sum-down",
                ].map((key) => [key, styles.getPropertyValue(key).trim().toLowerCase()]),
              );
            });
            const expectedPalette =
              theme === "light"
                ? {
                    "--act": "#2b3a4f",
                    "--act-ink": "#f2f5f9",
                    "--ok-dot": "#4f7a5e",
                    "--ok": "#3f6b50",
                    "--warn-dot": "#a8894f",
                    "--warn": "#7a6230",
                    "--bad": "#8e3b3b",
                    "--sum-up": "#9cc3a8",
                    "--sum-down": "#e2a3a3",
                  }
                : {
                    "--act": "#93a5bf",
                    "--act-ink": "#0c0c0d",
                    "--ok-dot": "#7fa98d",
                    "--ok": "#7fa98d",
                    "--warn-dot": "#c9ae7a",
                    "--warn": "#c9ae7a",
                    "--bad": "#c77474",
                    "--sum-up": "#2f5e40",
                    "--sum-down": "#7a2c2c",
                  };
            check(
              JSON.stringify(palette) === JSON.stringify(expectedPalette),
              `Unexpected ${theme} palette`,
            );
            check(
              (await page.locator(".btn.attn svg").count()) === 0,
              "Validate buttons must be text only",
            );
            check(
              await page.locator(".day-table").evaluate((el) => el.scrollWidth <= el.clientWidth),
              "My day table overflows horizontally",
            );
            check(
              await page.locator(".day-table tbody tr").evaluateAll((rows) =>
                rows
                  .filter((row) => row.cells.length === 5)
                  .every((row) => {
                    const cell = row.cells[4].getBoundingClientRect();
                    return [...row.querySelectorAll(".day-actions > *")].every((control) => {
                      const bounds = control.getBoundingClientRect();
                      return bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1;
                    });
                  }),
              ),
              "My day actions overlap another column",
            );
            check(
              (await page.getByRole("columnheader", { name: "Amount", exact: true }).count()) === 0,
              "Unexpected Amount column",
            );
            check(
              (await page.getByRole("columnheader", { name: "Status", exact: true }).count()) === 0,
              "Unexpected Status column",
            );
            check(
              (await page.getByRole("button", { name: "More actions", exact: false }).count()) ===
                0,
              "Unexpected More actions button",
            );
          }
          if (captureDir && viewport.width === 1440) {
            const path = `${captureDir}/${view.toLowerCase().replaceAll(" ", "-")}-${theme}.png`;
            await page.screenshot({ path });
            screenshots.push(path);
          }
        }
        await openView("Cases");
        await page.locator(".client-tile").first().click();
        await page.locator(".case-tile").first().click();
        await page.getByRole("tab", { name: "Markers", exact: false }).click();
        check(
          (await page.getByRole("columnheader", { name: "Weight", exact: true }).count()) === 0,
          "Unexpected marker Weight column",
        );
      }
    }
    await page
      .getByRole("group", { name: "Theme" })
      .getByRole("button", { name: "Auto", exact: true })
      .click();
    await openView("My day");
    await page
      .getByText("Incomplete estimate · $882.50 known; some pricing is unavailable", {
        exact: true,
      })
      .waitFor();
    check(
      (await page.locator(".datebadge").innerText()) === "1",
      "Expected one other day to validate",
    );
    check(
      (await page.locator(".datebadge").getAttribute("title")) ===
        "1 other day with periods to validate (15 Oct)",
      "Unexpected pending-day description",
    );
    await page.locator(".datebtn").click();
    check(
      (await page.locator('[data-calendar-day="2026-10-15"] i.p').count()) === 1,
      "Missing pending-day dot",
    );
    check(
      (await page.locator('[data-calendar-day="2026-10-14"] i:not(.p)').count()) === 1,
      "Missing validated-day dot",
    );
    const emptyDay = page.locator('[data-calendar-day="2026-10-01"]');
    check(
      ((await emptyDay.getAttribute("class")) ?? "").includes("off"),
      "Empty day must be hatched",
    );
    check(await emptyDay.isEnabled(), "Past empty days must remain selectable");
    check(
      await page.locator('[data-calendar-day="2026-10-18"]').isDisabled(),
      "Future day must be disabled",
    );
    check(
      (await page.getByText("Hatched: no work periods", { exact: true }).count()) === 1,
      "Missing calendar legend",
    );
    await emptyDay.click();
    await page.locator(".day-periods .empty b").getByText("No work periods").waitFor();
    check(
      (await page.locator(".datebadge").innerText()) === "2",
      "Expected two other days to validate",
    );
    await page.locator(".datebtn").click();
    await page.locator('[data-calendar-day="2026-10-15"]').click();
    await page
      .locator(".ph p")
      .first()
      .getByText("Thursday, 15 October 2026", { exact: false })
      .waitFor();
    await openView("Cases");
    const clientSort = page.getByLabel("Sort by", { exact: true });
    check(
      (await clientSort.inputValue()) === "toBill",
      "Expected default client sort by unbilled amount",
    );
    await clientSort.selectOption("name");
    const names = await page.locator(".client-tile .case-tile-top strong").allInnerTexts();
    const sortedNames = [...names].sort((a, b) =>
      a.toLowerCase().localeCompare(b.toLowerCase(), "en-US"),
    );
    check(JSON.stringify(names) === JSON.stringify(sortedNames), "Clients are not sorted by name");
    await openView("Billing");
    await openView("Cases");
    check(
      (await page.getByLabel("Sort by", { exact: true }).inputValue()) === "name",
      "Client sort was not preserved",
    );
    const billingClient = page.locator(".bill-client-group").first();
    const expand = billingClient.locator(".bill-expand");
    check(
      (await expand.getAttribute("aria-expanded")) === "false",
      "Billing client must start collapsed",
    );
    await expand.click();
    check((await expand.getAttribute("aria-expanded")) === "true", "Billing client did not expand");
    check(
      await page.getByRole("heading", { name: "Cases", exact: true }).isVisible(),
      "Expansion changed the screen",
    );
    check(
      await billingClient.locator(".bill-case-row").first().isVisible(),
      "Missing expanded case row",
    );
    const caseBarHeight = await billingClient
      .locator(".bill-case-row .bar")
      .first()
      .evaluate((el) => el.getBoundingClientRect().height);
    const clientBarHeight = await billingClient
      .locator(".bill-client-link .bar")
      .evaluate((el) => el.getBoundingClientRect().height);
    check(caseBarHeight < clientBarHeight, "Case bars must be thinner than client bars");
    await expand.click();
    check(
      (await expand.getAttribute("aria-expanded")) === "false",
      "Billing client did not collapse",
    );
    check(
      !(await billingClient.locator(".bill-case-row").first().isVisible()),
      "Collapsed case row remains visible",
    );
    await billingClient.locator(".bill-client-link").click();
    const breadcrumb = page.getByRole("navigation", { name: "Case breadcrumb" });
    await breadcrumb.waitFor();
    await breadcrumb.getByRole("button", { name: "Cases", exact: true }).click();
    await page.locator(".bill-client-group").first().locator(".bill-expand").click();
    await page.locator(".bill-client-group").first().locator(".bill-case-row").first().click();
    await page.getByRole("button", { name: "More case actions", exact: true }).click();
    check(
      await page.getByRole("button", { name: "Export source pack", exact: true }).isVisible(),
      "Missing source-pack action",
    );
    await breadcrumb.getByRole("button", { name: "Cases", exact: true }).click();
    await page.getByRole("searchbox", { name: "Search a client or a case" }).fill("Dawson");
    await page.getByRole("option").first().waitFor();
    await openView("Billing");
    await page.locator(".billing-card").first().click();
    await page.getByRole("heading", { name: "What will be on the invoice", exact: true }).waitFor();
    await openView("Activity");
    await page.getByRole("button", { name: "Work periods", exact: true }).click();
    await page.getByRole("heading", { name: "Timeline", exact: true }).waitFor();
    const periodList = page.getByRole("region", { name: "Work periods", exact: true });
    await periodList.waitFor();
    const secondPeriod = periodList.getByRole("button").nth(1);
    const selectedLabel = await secondPeriod.locator("span").first().locator("span").innerText();
    await secondPeriod.click();
    check(
      (await secondPeriod.getAttribute("aria-pressed")) === "true" &&
        (await page.locator(".activity-detail h2").innerText()) === selectedLabel,
      "The accessible period list must select the inspected period",
    );
    await openView("Settings");
    await page.getByRole("button", { name: "Capture and invoices", exact: true }).click();
    check(
      (await page.getByRole("button", { name: "Reset demo data", exact: true }).count()) === 0,
      "Unexpected demo reset control",
    );
    await page.getByRole("button", { name: "Desk pill", exact: true }).click();
    await page.getByRole("button", { name: "Open preview", exact: true }).click();
    await page.getByRole("heading", { name: "No document preview", exact: true }).waitFor();
    const previewHeight = await page
      .locator(".work-pill .pill-bar")
      .evaluate((bar) => bar.getBoundingClientRect().height);
    pill = await page.context().newPage();
    pill.on("pageerror", onPageError);
    pill.on("console", onConsole);
    await pill.setViewportSize({ width: 340, height: 490 });
    await pill.goto(new URL("pill.html", url).href);
    await pill.getByRole("button", { name: "TimeKeeper, toggle panel", exact: true }).waitFor();
    const pillHeight = await pill
      .locator(".work-pill .pill-bar")
      .evaluate((bar) => bar.getBoundingClientRect().height);
    check(previewHeight === 50 && pillHeight === previewHeight, "Pill preview geometry differs");
    check(errors.length === 0, `Browser errors: ${errors.join("\n")}`);
    return {
      status: "passed",
      views,
      viewports,
      themes,
      screenshots,
      checks: [
        "navigation",
        "shell overflow",
        "palette",
        "table headers and scrollbars",
        "calendar",
        "client sorting",
        "billing expansion",
        "case navigation and search",
        "invoice detail",
        "activity",
        "settings",
        "desk preview",
        "standalone pill",
        "console errors",
      ],
    };
  } finally {
    page.off("pageerror", onPageError);
    page.off("console", onConsole);
    if (pill) await pill.close();
  }
}
