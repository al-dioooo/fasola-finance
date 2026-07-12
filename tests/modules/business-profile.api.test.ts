import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BusinessProfileEntry } from "../../server/src/modules/business-profile/business-profile.store.js";
import { buildTestApp, loginAndGetCookie } from "../helpers/app.js";
import { createMigratedTestDatabase, type TestDatabase } from "../helpers/db.js";

interface ProfileListBody {
  items: BusinessProfileEntry[];
}

interface ProfileItemBody {
  item: BusinessProfileEntry;
}

const SEEDED_KEYS = [
  "about",
  "contact_info",
  "delivery_area",
  "delivery_eta",
  "opening_hours",
  "promos",
  "store_address"
];

describe("business profile API", () => {
  let testDb: TestDatabase;
  let app: FastifyInstance;
  let cookie: string;

  beforeAll(async () => {
    testDb = await createMigratedTestDatabase();
    app = await buildTestApp({ db: testDb.db });
    cookie = await loginAndGetCookie(app);
  });

  afterAll(async () => {
    await app.close();
    await testDb.close();
  });

  it("rejects unauthenticated requests with 401", async () => {
    const list = await app.inject({ method: "GET", url: "/api/business-profile" });
    expect(list.statusCode).toBe(401);

    const update = await app.inject({
      method: "PUT",
      url: "/api/business-profile/opening_hours",
      payload: { value: "Senin-Sabtu 08.00-17.00" }
    });
    expect(update.statusCode).toBe(401);
  });

  it("lists the seeded keys with empty values, ordered by key", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/business-profile",
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<ProfileListBody>();

    expect(body.items.map((item) => item.key)).toEqual(SEEDED_KEYS);

    for (const item of body.items) {
      expect(item.value).toBe("");
      expect(item.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    }
  });

  it("updates a value, trims it, and bumps updated_at", async () => {
    const before = await app.inject({
      method: "GET",
      url: "/api/business-profile",
      headers: { cookie }
    });
    const previous = before
      .json<ProfileListBody>()
      .items.find((item) => item.key === "opening_hours");
    expect(previous).toBeDefined();

    const response = await app.inject({
      method: "PUT",
      url: "/api/business-profile/opening_hours",
      headers: { cookie },
      payload: { value: "  Senin-Sabtu 08.00-17.00, Minggu libur  " }
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json<ProfileItemBody>().item;
    expect(updated.key).toBe("opening_hours");
    expect(updated.value).toBe("Senin-Sabtu 08.00-17.00, Minggu libur");
    expect(updated.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/u);
    expect(updated.updatedAt).not.toBe(previous?.updatedAt);

    // Persisted, not just echoed.
    const after = await app.inject({
      method: "GET",
      url: "/api/business-profile",
      headers: { cookie }
    });
    const persisted = after
      .json<ProfileListBody>()
      .items.find((item) => item.key === "opening_hours");
    expect(persisted?.value).toBe("Senin-Sabtu 08.00-17.00, Minggu libur");
    expect(persisted?.updatedAt).toBe(updated.updatedAt);
  });

  it("accepts an empty value (bot treats it as 'not provided')", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/business-profile/opening_hours",
      headers: { cookie },
      payload: { value: "   " }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ProfileItemBody>().item.value).toBe("");
  });

  it("inserts a new key on first write (picked up by the bot automatically)", async () => {
    const response = await app.inject({
      method: "PUT",
      url: "/api/business-profile/payment_methods",
      headers: { cookie },
      payload: { value: "Transfer BCA atau tunai" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json<ProfileItemBody>().item.key).toBe("payment_methods");

    const list = await app.inject({
      method: "GET",
      url: "/api/business-profile",
      headers: { cookie }
    });
    const inserted = list
      .json<ProfileListBody>()
      .items.find((item) => item.key === "payment_methods");
    expect(inserted?.value).toBe("Transfer BCA atau tunai");
  });

  it("rejects malformed keys and bodies with 400", async () => {
    const badKey = await app.inject({
      method: "PUT",
      url: `/api/business-profile/${encodeURIComponent("Jam Buka!")}`,
      headers: { cookie },
      payload: { value: "x" }
    });
    expect(badKey.statusCode).toBe(400);

    const badBody = await app.inject({
      method: "PUT",
      url: "/api/business-profile/opening_hours",
      headers: { cookie },
      payload: { value: 42 }
    });
    expect(badBody.statusCode).toBe(400);
  });
});
