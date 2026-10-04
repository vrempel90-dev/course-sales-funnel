import { describe, it, expect } from "vitest";
import { t, content, translateMessage } from "../src/i18n";
import { kz } from "../src/i18n/kz";
import { permitted } from "../src/services/auth";
import { runtimeConfig } from "../src/lib/config";
import { safeError } from "../src/lib/errors";
import { pageIndex, pagination } from "../src/utils/pagination";
import { home } from "../src/bot/keyboards/admin";
import {
  tariffSchema,
  courseSchema,
  requisitesSchema,
  defaultSettings,
  configSchema,
} from "../src/services/schemas";
describe("roles and validation", () => {
  it("localizes RU/KZ and falls back for missing UI keys and marketing fields", () => {
    expect(t("admin.title", "RU")).toBe("⚙️ Админ-панель");
    expect(t("admin.title", "KZ")).toBe("⚙️ Әкімші панелі");
    const dictionary: Partial<typeof kz> = kz;
    const original = dictionary["common.yes"];
    try {
      dictionary["common.yes"] = "";
      expect(t("common.yes", "KZ")).toBe("Да");
    } finally {
      dictionary["common.yes"] = original;
    }
    expect(
      content(
        [
          { language: "RU", title: "Original", description: "RU details" },
          { language: "KZ", title: "Атау", description: null },
        ],
        "KZ",
        "description",
      ),
    ).toBe("RU details");
    expect(translateMessage("Введите целое число", "KZ")).toBe(
      "Бүтін сан енгізіңіз",
    );
  });
  it("accepts only HTTP(S) media and trial URLs", () => {
    expect(
      courseSchema.shape.imageUrl.safeParse("javascript:alert(1)").success,
    ).toBe(false);
    expect(
      configSchema.shape.trialBookingUrl.safeParse("ftp://example.com").success,
    ).toBe(false);
    expect(
      courseSchema.shape.demoVideoUrl.safeParse("https://example.com/video")
        .success,
    ).toBe(true);
  });
  it("OWNER has every section", () => {
    for (const s of [
      "staff",
      "requisites",
      "settings",
      "payments",
      "courses",
      "clients",
      "requests",
      "access",
    ] as const)
      expect(permitted("OWNER", s, true)).toBe(true);
  });
  it("ADMIN has operational access but cannot manage staff/settings", () => {
    expect(permitted("ADMIN", "payments", true)).toBe(true);
    expect(permitted("ADMIN", "courses", true)).toBe(true);
    for (const s of ["staff", "requisites", "settings"] as const)
      expect(permitted("ADMIN", s, true)).toBe(false);
  });
  it("MANAGER can edit clients and requests only", () => {
    expect(permitted("MANAGER", "clients", true)).toBe(true);
    expect(permitted("MANAGER", "requests", true)).toBe(true);
    for (const s of [
      "courses",
      "payments",
      "staff",
      "settings",
      "requisites",
      "access",
    ] as const)
      expect(permitted("MANAGER", s, true)).toBe(false);
  });
  it("menus contain only permitted sections and compact callbacks", () => {
    for (const role of ["OWNER", "ADMIN", "MANAGER"] as const)
      for (const row of home(role).inline_keyboard)
        for (const b of row)
          if ("callback_data" in b)
            expect(Buffer.byteLength(b.callback_data)).toBeLessThanOrEqual(64);
    expect(JSON.stringify(home("MANAGER"))).not.toContain("a:menu:staff");
  });
  it("defaults and empty token configuration are valid", () => {
    expect(configSchema.parse(defaultSettings).inviteLifetimeHours).toBe(24);
    expect(
      runtimeConfig({ DATABASE_URL: "postgresql://db", TELEGRAM_BOT_TOKEN: "" })
        .TELEGRAM_BOT_TOKEN,
    ).toBeUndefined();
  });
  it("rejects nonnumeric owner and invalid port", () => {
    expect(() =>
      runtimeConfig({ DATABASE_URL: "x", OWNER_TELEGRAM_ID: "abc" }),
    ).toThrow();
    expect(() => runtimeConfig({ DATABASE_URL: "x", PORT: "99999" })).toThrow();
  });
  it("redacts token and DB URL", () => {
    expect(
      safeError(new Error("bot123456:secret_token postgresql://u:p@host/db")),
    ).toBe("[TOKEN] [DATABASE_URL]");
  });
  it("validates empty/last page and rejects forged page", () => {
    expect(pagination(0, 99)).toMatchObject({ page: 0, pages: 1, skip: 0 });
    expect(pagination(11, 99)).toMatchObject({ page: 2, skip: 10 });
    expect(() => pageIndex("-1")).toThrow();
    expect(() => pageIndex("NaN")).toThrow();
  });
  it("requires requisites before enabling and matches country currency", () => {
    expect(() =>
      requisitesSchema.parse({
        country: "KZ",
        currency: "RUB",
        enabled: false,
        title: "X",
        instruction: "",
        requisites: "",
      }),
    ).toThrow();
    expect(() =>
      requisitesSchema.parse({
        country: "KZ",
        currency: "KZT",
        enabled: true,
        title: "X",
        instruction: "",
        requisites: "",
      }),
    ).toThrow();
  });
  it("rejects negative prices and forged channel IDs", () => {
    expect(tariffSchema.shape.priceKZT.safeParse("-1").success).toBe(false);
    expect(courseSchema.shape.telegramChannelId.safeParse("123").success).toBe(
      false,
    );
  });
});
