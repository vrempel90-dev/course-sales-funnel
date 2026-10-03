import { Prisma, User, RecommendationRule } from "@prisma/client";
export function matchesRule(
  rule: Pick<
    RecommendationRule,
    "experienceLevel" | "categoryId" | "learningGoal" | "matchMode"
  >,
  user: Pick<User, "experienceLevel" | "categoryId" | "learningGoal">,
) {
  const checks = (["experienceLevel", "categoryId", "learningGoal"] as const)
    .filter((key) => rule[key] !== null)
    .map((key) => rule[key] === user[key]);
  return (
    checks.length === 0 ||
    (rule.matchMode === "ANY" ? checks.some(Boolean) : checks.every(Boolean))
  );
}
export async function recommend(tx: Prisma.TransactionClient, user: User) {
  const rules = await tx.recommendationRule.findMany({
    where: {
      active: true,
      course: { status: "ACTIVE", category: { active: true } },
    },
    orderBy: [{ priority: "desc" }, { id: "asc" }],
    include: { course: true },
  });
  const matched = rules.filter((rule) => matchesRule(rule, user));
  const ids = [...new Set(matched.map((rule) => rule.courseId))].slice(0, 5);
  if (!ids.length) {
    const fallback = await tx.course.findMany({
      where: {
        status: "ACTIVE",
        category: { active: true },
        ...(user.categoryId ? { categoryId: user.categoryId } : {}),
      },
      orderBy: { createdAt: "asc" },
      take: 5,
    });
    ids.push(...fallback.map((course) => course.id));
  }
  for (const courseId of ids) {
    await tx.courseRecommendation.upsert({
      where: {
        userId_courseId_questionnaireVersion: {
          userId: user.id,
          courseId,
          questionnaireVersion: user.questionnaireVersion,
        },
      },
      update: {},
      create: {
        userId: user.id,
        courseId,
        questionnaireVersion: user.questionnaireVersion,
        score:
          matched.find((rule) => rule.courseId === courseId)?.priority ?? 0,
      },
    });
  }
  return ids;
}
