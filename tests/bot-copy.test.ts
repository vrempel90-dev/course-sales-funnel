import { describe, expect, it, vi } from "vitest";
import { permitted } from "../src/services/auth";
import type { PrismaClient } from "@prisma/client";
import {
  botCopy, copyKey, copyKeys, defaultBotCopy, fillText,
} from "../src/services/bot-copy";

describe("editable Telegram copy", () => {
  it("keeps existing default Russian/Kazakh texts when no override exists", async () => {
    const db = { setting: { findUnique: vi.fn().mockResolvedValue(null) } } as unknown as PrismaClient;
    const ru = await botCopy(db, "RU");
    const kz = await botCopy(db, "KZ");
    expect(ru.welcome).toBe(defaultBotCopy.RU.welcome);
    expect(kz.welcome).toBe(defaultBotCopy.KZ.welcome);
    expect(ru.selfTariffDetails).toContain("Самостоятельный");
    expect(kz["courseTitle.classic-body-face"]).toBeTruthy();
  });

  it("uses persisted settings for just the requested language", async () => {
    const findUnique = vi.fn(async (args: { where: { key: string } }) =>
      args.where.key === "bot.copy.RU"
        ? { value: { welcome: "Новый текст", buy: "Купить", unknown: "ignore" } }
        : { value: { welcome: "Қош келдіңіз" } },
    );
    const db = { setting: { findUnique } } as unknown as PrismaClient;
    const russian = await botCopy(db, "RU");
    const kazakh = await botCopy(db, "KZ");
    expect(russian.welcome).toBe("Новый текст");
    expect(russian.buy).toBe("Купить");
    expect(russian.unknown).toBeUndefined();
    expect(russian.familyBenefit).toBe(defaultBotCopy.RU.familyBenefit);
    expect(kazakh.welcome).toBe("Қош келдіңіз");
    expect(kazakh.buy).toBe(defaultBotCopy.KZ.buy);
    expect(findUnique).toHaveBeenCalledTimes(2);
  });

  it("ignores blank, oversized, or non-string saved values", async () => {
    const db = {
      setting: {
        findUnique: vi.fn().mockResolvedValue({
          value: { welcome: "  ", buy: 12, questionPrompt: "x".repeat(3501) },
        }),
      },
    } as unknown as PrismaClient;
    const t = await botCopy(db, "RU");
    expect(t.welcome).toBe(defaultBotCopy.RU.welcome);
    expect(t.buy).toBe(defaultBotCopy.RU.buy);
    expect(t.questionPrompt).toBe(defaultBotCopy.RU.questionPrompt);
  });

  it("indexes only known fields for edit callbacks", () => {
    const ru = copyKeys("RU");
    const i = ru.indexOf("welcome");
    expect(copyKey("RU", String(i))).toBe("welcome");
    expect(() => copyKey("RU", "-1")).toThrow();
    expect(() => copyKey("RU", "2000")).toThrow();
    expect(() => copyKey("RU", "1:delete")).toThrow();
  });

  it("interpolates course, tariff and amount without modifying other text", () => {
    expect(fillText("Курс {course}, {tariff}: {amount} ₸", {
      course: "Классический", tariff: "SELF", amount: "20 000",
    })).toBe("Курс Классический, SELF: 20 000 ₸");
  });
});

describe("bot copy permissions", () => {
  it("lets owners and administrators write, but denies managers", () => {
    expect(permitted("OWNER", "copy", true)).toBe(true);
    expect(permitted("ADMIN", "copy", true)).toBe(true);
    expect(permitted("MANAGER", "copy", true)).toBe(false);
    expect(permitted("ADMIN", "settings", true)).toBe(false);
  });
});
