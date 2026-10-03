import { describe, expect, it } from "vitest";
import { authorize } from "../src/admin/permissions";
import { matchesRule } from "../src/services/recommendations";
import { hashPassword, verifyPassword } from "../src/lib/password";
import { paymentSettingSchema } from "../src/services/settings";
describe("role permissions", () => {
  it("permits ADMIN mutations", () =>
    expect(() => authorize("ADMIN", "settings", true)).not.toThrow());
  it("permits MANAGER to work with clients and requests", () => {
    expect(() => authorize("MANAGER", "clients", true)).not.toThrow();
    expect(() => authorize("MANAGER", "requests", true)).not.toThrow();
  });
  it.each(["settings", "admins", "payments", "courses", "actions", "access"])(
    "blocks MANAGER mutation: %s",
    (resource) => expect(() => authorize("MANAGER", resource, true)).toThrow(),
  );
  it("permits read-only courses and payments", () => {
    expect(() => authorize("MANAGER", "courses")).not.toThrow();
    expect(() => authorize("MANAGER", "payments")).not.toThrow();
  });
});
describe("recommendation rule matching", () => {
  const user = {
    experienceLevel: "BEGINNER",
    categoryId: "body",
    learningGoal: "PERSONAL",
  } as const;
  it("requires all configured criteria for ALL", () =>
    expect(
      matchesRule(
        {
          experienceLevel: "BEGINNER",
          categoryId: "face",
          learningGoal: null,
          matchMode: "ALL",
        },
        user,
      ),
    ).toBe(false));
  it("accepts any configured criterion for ANY", () =>
    expect(
      matchesRule(
        {
          experienceLevel: "BEGINNER",
          categoryId: "face",
          learningGoal: null,
          matchMode: "ANY",
        },
        user,
      ),
    ).toBe(true));
  it("treats null criteria as wildcards", () =>
    expect(
      matchesRule(
        {
          experienceLevel: "BEGINNER",
          categoryId: null,
          learningGoal: null,
          matchMode: "ALL",
        },
        user,
      ),
    ).toBe(true));
});
describe("configuration and credentials", () => {
  it("never stores plain text passwords", async () => {
    const hash = await hashPassword("test-long-password");
    expect(hash).not.toContain("test-long-password");
    expect(await verifyPassword("test-long-password", hash)).toBe(true);
    expect(await verifyPassword("wrong", hash)).toBe(false);
  });
  it("requires requisites and instruction when payment is enabled", () =>
    expect(() =>
      paymentSettingSchema.parse({
        enabled: true,
        title: "Bank",
        instruction: "",
        requisites: "",
      }),
    ).toThrow());
});
