import { expect, test, type Page } from "@playwright/test";

const CAREGIVER = { email: "caregiver.a@venloop.demo", password: "venloop-demo-123" };
const ADMIN = { email: "admin@venloop.demo", password: "venloop-demo-123" };

function silentWav(seconds = 0.5): Buffer {
  const sampleRate = 8_000;
  const samples = Math.round(sampleRate * seconds);
  const data = Buffer.alloc(samples * 2);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

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
    await expect(page.getByText("SIMULATED CALL", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("no real phone, SMS, or email")).toBeVisible();
    await expect(page.getByText("Requests microphone access. Nothing is dialed.")).toBeVisible();
  });

  test("turn-based demo submits a suggested reply manually without a microphone", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: "Turn-Based Demo" }).click();
    await expect(page.getByRole("button", { name: "Submit answer" })).toBeVisible();
    await page.getByRole("button", { name: "Yes, I took my medicine this morning." }).click();
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText("Yes, I took my medicine this morning.", { exact: true }).last()).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/anything else you would like to tell me/i).first()).toBeVisible({
      timeout: 45_000,
    });
    await page.getByLabel("Turn-based patient reply").fill("No, that's all.");
    await page.getByRole("button", { name: "Submit answer" }).click();
    await expect(page.getByText(/Call complete/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test("End call stops the call immediately without a synthetic closing turn", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: "Turn-Based Demo" }).click();
    await page.getByRole("button", { name: "Yes, I took my medicine this morning." }).click();
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });

    const submittedBodies: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/submit-input")) submittedBodies.push(request.postData() ?? "");
    });

    await page.getByRole("button", { name: "End call" }).click();
    await expect(page.getByText(/Call complete/i).first()).toBeVisible({ timeout: 3_000 });
    await page.waitForTimeout(1_000);
    expect(submittedBodies.some((body) => body.includes("No, that is all"))).toBe(false);
  });

  test("second simulated call still plays voice audio after ending the first", async ({ page }) => {
    test.setTimeout(120_000);
    const wav = silentWav(1);
    await page.route("**/api/v1/speech/tts", (route) =>
      route.fulfill({ status: 200, contentType: "audio/wav", body: wav }),
    );
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: "Turn-Based Demo" }).click();
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(700);

    await page.getByRole("button", { name: "End call" }).click();
    await page.getByRole("button", { name: "Start new simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).last()).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(700);
    const currentTime = await page
      .locator("audio")
      .evaluate((element) => (element as HTMLAudioElement).currentTime);
    expect(currentTime).toBeGreaterThan(0);
  });

  test("nausea follow-up keeps the simulated call open until answered", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: /TC3/ }).click();
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/nausea_or_vomiting/i).first()).toBeVisible({ timeout: 45_000 });

    await page.getByText("Type a reply (fallback)").click();
    await page.getByLabel("Type a reply instead").fill("It is mild and started this morning.");
    await page.getByRole("button", { name: "Send typed reply" }).click();
    await expect(page.getByText(/We have recorded your concerns/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/Call complete/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test("breathing trouble with a dosage question triggers the emergency path", async ({ page }) => {
    test.setTimeout(90_000);
    await login(page, CAREGIVER);
    await page.goto("/demo/call-simulator?patient=00000000-0000-4000-8000-000000000014");
    await page.getByRole("button", { name: /TC6/ }).click();
    await page.getByRole("button", { name: "Start simulated call" }).click();
    await expect(page.getByText("SIMULATED CALL STARTED", { exact: false }).first()).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByText(/emergency services/i).first()).toBeVisible({ timeout: 45_000 });
    await expect(page.getByText(/emergency guidance/i).first()).toBeVisible();
    await expect(page.getByText(/Call complete/i).first()).toBeVisible({ timeout: 45_000 });
  });

  test("TC1-TC4 official runs pass with expected decisions", async ({ page }) => {
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

