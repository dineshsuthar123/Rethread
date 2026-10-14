import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
const widths = [360, 390, 768, 1024, 1440];
for (const width of widths) {
  test(`marketing and replay remain readable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Fix the failure. Keep the lesson." }),
    ).toBeVisible();
    await expect(page.locator(".intro")).toHaveCount(0);
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await mkdir("docs/artifacts", { recursive: true });
    await page.screenshot({
      path: `docs/artifacts/marketing-${width}.png`,
      fullPage: true,
    });
    await page.getByRole("link", { name: "Try an interactive case" }).click();
    await expect(page).toHaveURL(/\/studio\/cases\/example/);
    await expect(
      page.getByText("INTERACTIVE EXAMPLE · NO REPOSITORY CONNECTED"),
    ).toBeVisible();
    await page.getByRole("button", { name: "03 Guard", exact: true }).click();
    if (width <= 800) {
      await page.getByRole("tab", { name: "Guard", exact: true }).click();
    }
    await page
      .getByRole("button", { name: "Introduce a later regression" })
      .click();
    await expect(
      page.getByText("Recurrence detected", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `docs/artifacts/studio-${width}.png`,
      fullPage: true,
    });
    await page.reload();
    await expect(
      page.getByText("DISPOSABLE EXAMPLE / NO LIVE JOB"),
    ).toBeVisible();
  });
}
test("intro is skippable, nonblocking and session-only; rapid route changes remain usable", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Skip introduction" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Skip introduction" }).click();
  await expect(page.locator(".intro")).toHaveCount(0);
  await page.getByRole("link", { name: "Try an interactive case" }).click();
  await page.getByRole("link", { name: "THE IDEA" }).click();
  await expect(page.locator(".intro")).toHaveCount(0);
  await page.reload();
  await expect(page.locator(".intro")).toHaveCount(0);
  await page.getByRole("button", { name: "Chapters" }).click();
  await page.getByRole("link", { name: "Documentation", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Evidence you can take with you." }),
  ).toBeVisible();
});
test("keyboard chapter menu and command search can close without trapping focus", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/studio/cases/example");
  await page.getByRole("button", { name: "Chapters" }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", { name: "Interactive example", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".chapter-menu")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(
    page.getByRole("dialog", { name: "Search Cases" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("browser Back restores the previous reading position", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.evaluate(() => window.scrollTo(0, 640));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);
  // Activate the route without the test driver scrolling its offscreen header into view.
  await page
    .getByRole("link", { name: "Field notes", exact: true })
    .evaluate((link: HTMLAnchorElement) => link.click());
  await expect(page).toHaveURL(/\/docs/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(640);
});
test("expired session is explicit, login and connection have usable recovery", async ({
  page,
}) => {
  await page.route("**/api/session", (route) =>
    route.fulfill({
      status: 401,
      json: { error: { code: "session_expired", message: "Session expired" } },
    }),
  );
  await page.route("**/api/capabilities", (route) =>
    route.fulfill({ json: { loginConfigured: true } }),
  );
  await page.goto("/studio");
  await expect(
    page.getByRole("heading", { name: "Bring your repository along." }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Sign in with GitHub" }).click();
  await expect(
    page.getByRole("link", { name: "Continue with GitHub" }),
  ).toHaveAttribute("href", "/api/auth/github");
});
test("persisted cursor reconnect never resubmits the Case and approval binds the proposal", async ({
  page,
}) => {
  const id = "00000000-0000-4000-8000-000000000001";
  const snapshot = {
    id,
    repository_id: id,
    title: "A persisted failure",
    state: "ready_for_review",
    base_sha: "a".repeat(40),
    branch: "main",
    reason: null,
    cursor: 1,
    archived: false,
    data: {
      request: {
        behaviorContract: "One notification",
        reproduction: {
          kind: "pytest",
          test: "tests/test_delivery.py::test_retry",
        },
      },
      checks: [],
      proposal: {
        digest: "b".repeat(64),
        files: [],
        diff: "+ atomic_claim()",
        rationale: "Captured evidence",
        guard: null,
      },
    },
  };
  let polls = 0,
    approvals = 0,
    publishes = 0;
  await page.route("**/api/session", (r) =>
    r.fulfill({
      json: {
        user: { login: "fixture", avatarUrl: "" },
        csrf: "fixture-csrf",
        tenantId: id,
      },
    }),
  );
  await page.route(`**/api/cases/${id}`, (r) => r.fulfill({ json: snapshot }));
  await page.route(`**/api/cases/${id}/events*`, (r) => {
    polls++;
    return polls === 1
      ? r.abort()
      : r.fulfill({
          json: { events: [], cursor: 1, gap: false, hasMore: false },
        });
  });
  await page.route(`**/api/cases/${id}/approve`, (r) => {
    approvals++;
    expect(r.request().postDataJSON().digest).toBe("b".repeat(64));
    snapshot.data = Object.assign(snapshot.data, {
      approvedDigest: "b".repeat(64),
    });
    return r.fulfill({ json: snapshot });
  });
  await page.route(`**/api/cases/${id}/publish`, (r) => {
    publishes++;
    expect(r.request().headers()["idempotency-key"]).toBe(`publish-${id}`);
    snapshot.state = "publishing";
    return r.fulfill({ json: snapshot });
  });
  await page.goto(`/studio/cases/${id}`);
  await expect(page.getByText("Reconnecting · job continues")).toBeVisible();
  await expect(page.getByText("Connected", { exact: true })).toBeVisible({
    timeout: 10000,
  });
  await page.getByRole("button", { name: "Approve this proposal" }).click();
  await page.getByRole("button", { name: "Publish draft PR" }).click();
  await expect(page.getByText("publishing", { exact: true })).toBeVisible();
  expect(approvals).toBe(1);
  expect(publishes).toBe(1);
});
test("intro and route seam review recording", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(page.locator(".intro")).toHaveCount(0, { timeout: 5000 });
  await page.getByRole("link", { name: "Try an interactive case" }).click();
  await page.getByRole("button", { name: "02 Repair", exact: true }).click();
  await page.getByRole("button", { name: "03 Guard", exact: true }).click();
  await page
    .getByRole("button", { name: "Introduce a later regression" })
    .click();
  await expect(
    page.getByText("Recurrence detected", { exact: true }),
  ).toBeVisible();
});
test("keyboard skip link, mobile tabs, 200% zoom and tiny identity remain usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => (document.documentElement.style.zoom = "2"));
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/artifacts/zoom-200.png",
    fullPage: true,
  });
  await page.evaluate(() => (document.documentElement.style.zoom = "1"));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/studio/cases/example");
  await page.getByRole("tab", { name: "Failure", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Repair", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.goto("/");
  await page.setViewportSize({ width: 640, height: 200 });
  await page.evaluate(() => {
    document.body.innerHTML =
      '<main style="padding:40px;background:#f3f0e8;display:flex;gap:32px">' +
      [16, 24, 32]
        .map(
          (size) =>
            `<figure><img width="${size}" height="${size}" src="/brand/favicon.svg" alt="Rethread at ${size}px"/><figcaption>${size}px</figcaption></figure>`,
        )
        .join("") +
      "</main>";
  });
  await page.screenshot({ path: "docs/artifacts/identity-small.png" });
});
