import { expect, test, type Page } from "@playwright/test";

const CAREGIVER = { email: "caregiver.a@venloop.demo", password: "venloop-demo-123" };
const ADMIN = { email: "admin@venloop.demo", password: "venloop-demo-123" };

async function login(page: Page, user: { email: string; password: string }) {
  await page.goto("/login");
  await page.locator('input[type="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Caregivers land on /dashboard; super-admins land on /admin (separate shells).
  await page.waitForURL(/\/(dashboard|admin)/);
}

test.describe("VenLoop e2e (PRD 16.3)", () => {
  test("unauthenticated access redirects to login", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForURL(/\/login/);
    await expect(page.getByRole("heading", { name: "VenLoop sign in" })).toBeVisible();
  });

  test("caregiver login reaches dashboard with persisted metrics", async ({ page }) => {
    await login(page, CAREGIVER);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Assigned patients")).toBeVisible();
    await expect(page.getByText("All numbers come from persisted records")).toBeVisible();
  });

  test("super-admin pages are restricted for caregivers", async ({ page }) => {
    await login(page, CAREGIVER);
    await page.goto("/admin");
    await page.waitForURL(/\/dashboard/);
  });

  test("call simulator is labeled as simulated", async ({ page }) => {
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator");
    await expect(page.getByText("SIMULATED CALL — browser rehearsal only")).toBeVisible();
    await expect(page.getByText("no real phone call")).toBeVisible();
  });

  test("nausea follow-up keeps the simulated call open until answered", async ({ page }) => {
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED")).toBeVisible();
    await page.getByRole("button", { name: /TC3/ }).click();
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/When did the nausea start/i)).toBeVisible();
    await expect(page.getByText(/nausea_or_vomiting details/i)).toBeVisible();

    await page.getByRole("textbox").fill("It started this morning and it is mild.");
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/We have recorded your concerns/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/Call complete - transcript saved/i)).toBeVisible({ timeout: 30_000 });
  });

  test("breathing trouble with a dosage question triggers the emergency path", async ({ page }) => {
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await page.getByRole("button", { name: /TC6/ }).click();
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/emergency services/i)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/emergency guidance/i).first()).toBeVisible();
    await expect(page.getByText(/Call complete - transcript saved/i)).toBeVisible({ timeout: 30_000 });
  });

  test("TC1–TC4 official runs pass with expected decisions", async ({ page }) => {
    await login(page, ADMIN);
    await page.goto("/admin/runs");
    for (const id of ["TC1", "TC2", "TC3", "TC4"] as const) {
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes("/api/v1/test-runs") && r.request().method() === "POST",
        ),
        page.getByRole("button", { name: `Run ${id}` }).click(),
      ]);
      expect(response.ok(), `${id} run request failed`).toBeTruthy();
      const body = (await response.json()) as { data?: { status?: string; failure_summary?: string | null } };
      expect(body.data?.status, `${id}: ${body.data?.failure_summary ?? ""}`).toBe("passed");
    }
  });

  test("escalation cases can be acknowledged and resolved by a caregiver", async ({ page }) => {
    // Run TC3 as admin first so a symptom case exists for the assigned patient.
    await login(page, ADMIN);
    await page.goto("/admin/runs");
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/v1/test-runs") && r.request().method() === "POST",
      ),
      page.getByRole("button", { name: "Run TC3" }).click(),
    ]);
    expect(response.ok()).toBeTruthy();

    await login(page, CAREGIVER);
    await page.goto("/cases");
    await expect(page.getByRole("heading", { name: "Escalation cases" })).toBeVisible();
    await page.getByRole("button", { name: "Acknowledge" }).first().click();
    await expect(page.getByText("acknowledged").first()).toBeVisible();
    // Category action after acknowledgement.
    await page.getByRole("button", { name: "Contacted patient" }).first().click();
    await expect(page.getByText("follow_up_in_progress").first()).toBeVisible();
    // Resolve with a note.
    await page.getByPlaceholder("Outcome note (optional)").first().fill("Spoke to patient, resting.");
    await page.getByRole("button", { name: "Mark resolved" }).first().click();
    await expect(page.getByText("resolved_reported").first()).toBeVisible();
  });

  test("evidence page shows decision trail and export control", async ({ page }) => {
    await login(page, CAREGIVER);
    await page.goto("/check-ins");
    await page.getByRole("link", { name: "Evidence" }).first().click();
    await expect(page.getByRole("heading", { name: "Check-in evidence" })).toBeVisible();
    await expect(page.getByText("Decisions")).toBeVisible();
    await expect(page.getByRole("button", { name: "Download evidence JSON" })).toBeVisible();
  });
});

