import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "pg";

/**
 * RLS integration tests against local Supabase Postgres (PRD 16.2).
 * Simulates the `authenticated` role via request.jwt.claims — same mechanism PostgREST uses.
 * Each test runs in a savepoint so a rejected statement cannot poison the next test.
 */
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CAREGIVER_A = "10000000-0000-4000-8000-000000000001";
const CAREGIVER_B = "10000000-0000-4000-8000-000000000002";
const PATIENT = "10000000-0000-4000-8000-000000000010";

async function asAuthenticated(client: Client, userId: string): Promise<void> {
  await client.query("set role authenticated");
  await client.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

async function asPostgres(client: Client): Promise<void> {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '', true)");
}



async function withTransaction<T>(client: Client, fn: () => Promise<T>): Promise<T> {
    await client.query("begin");
  try {
    const result = await fn();
    await asPostgres(client);
    await client.query("rollback");
    return result;
  } catch (err) {
    await asPostgres(client).catch(() => undefined);
    await client.query("rollback").catch(() => undefined);
    throw err;
  }
}

describe("RLS role isolation", () => {
  const db = new Client({ connectionString: DATABASE_URL });

  beforeAll(async () => {
    await db.connect();
    await db.query(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at, instance_id, aud, role, created_at, updated_at)
       values ($1, $2, 'x', now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now()),
              ($3, $4, 'x', now(), '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', now(), now())
       on conflict (id) do nothing`,
      [CAREGIVER_A, "rls-a@venloop.test", CAREGIVER_B, "rls-b@venloop.test"],
    );
    await db.query(
      `insert into profiles (id, role, display_name, email) values
         ($1, 'caregiver', 'RLS A', 'rls-a@venloop.test'),
         ($2, 'caregiver', 'RLS B', 'rls-b@venloop.test')
       on conflict (id) do nothing`,
      [CAREGIVER_A, CAREGIVER_B],
    );
    await db.query(
      `insert into patients (id, display_name, timezone) values ($1, 'RLS Patient', 'UTC') on conflict (id) do nothing`,
      [PATIENT],
    );
    await db.query(
      `insert into caregiver_patient_assignments (caregiver_id, patient_id, created_by)
       values ($1, $2, $1) on conflict (caregiver_id, patient_id) do nothing`,
      [CAREGIVER_A, PATIENT],
    );
  });

  afterAll(async () => {
    await db.query(
      `delete from caregiver_patient_assignments where patient_id = $1;
       delete from patients where id = $1;
       delete from profiles where id in ($2, $3);
       delete from auth.users where id in ($2, $3);`,
      [PATIENT, CAREGIVER_A, CAREGIVER_B],
    ).catch(() => undefined);
    await db.end();
  });

  it("assigned caregiver reads the patient; unassigned caregiver does not", async () => {
    await withTransaction(db, async () => {
      await asAuthenticated(db, CAREGIVER_A);
      const visibleToA = await db.query("select id from patients where id = $1", [PATIENT]);
      expect(visibleToA.rowCount).toBe(1);

      await asAuthenticated(db, CAREGIVER_B);
      const visibleToB = await db.query("select id from patients where id = $1", [PATIENT]);
      expect(visibleToB.rowCount).toBe(0);
    });
  });

  it("caregiver cannot change their own role", async () => {
    await expect(
      withTransaction(db, async () => {
        await asAuthenticated(db, CAREGIVER_A);
        await db.query("update profiles set role = 'super_admin' where id = $1", [CAREGIVER_A]);
      }),
    ).rejects.toThrow(/role change requires super_admin/);

    const still = await db.query("select role from profiles where id = $1", [CAREGIVER_A]);
    expect(still.rows[0]?.role).toBe("caregiver");
  });

  it("authenticated users cannot write operational tables directly", async () => {
    await expect(
      withTransaction(db, async () => {
        await asAuthenticated(db, CAREGIVER_A);
        await db.query(`insert into check_ins (patient_id, channel) values ($1, 'manual_test')`, [
          PATIENT,
        ]);
      }),
    ).rejects.toThrow();
  });

  it("assigned caregiver can record consent for their patient", async () => {
    await withTransaction(db, async () => {
      await asAuthenticated(db, CAREGIVER_A);
      const result = await db.query(
        `insert into consents (patient_id, consent_type, status, recorded_by)
         values ($1, 'rls_test', 'granted', $2) returning id`,
        [PATIENT, CAREGIVER_A],
      );
      expect(result.rowCount).toBe(1);
    });
  });
});

