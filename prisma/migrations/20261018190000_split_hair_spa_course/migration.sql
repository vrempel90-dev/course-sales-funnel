-- Keep existing lash/brow/Guasha course and give hair specialists a dedicated course.
-- Update displayed text during Railway's pre-deploy migration (the seed is not run there).
-- Do not replace existing enrollments, payments, or course IDs.
BEGIN;

UPDATE "Course"
SET "title" = 'Массаж ШВЗ и массаж лица Гуаша',
    "shortDescription" = 'Экспресс-уход для лэшмейкеров, бровистов и косметологов.',
    "fullDescription" = $lashes$Для лэшмейкеров, бровистов и косметологов.

Максимальное расслабление, пока клиент отдыхает на кушетке или с маской!

Этот модуль поможет дополнить длительные процедуры, например наращивание ресниц, ламинирование и уход с масками, расслабляющим массажем — когда он совместим с основным уходом.

Что входит в программу модуля:
• Экспресс-массаж ШВЗ: мягкая работа с затылочной зоной, трапецией и плечами с учётом положения клиента.
• Массаж лица скребком Гуаша: постановка руки, угол наклона скребка и бережные движения по массажным линиям.
• Расслабляющий уход за лицом на 10–15 минут, гигиена и противопоказания.
• Как преподносить услугу: как комплимент от мастера или отдельный «VIP-массаж».

Результат: Вы сможете дополнить салонную процедуру расслабляющим уходом и предложить клиенту больше комфорта.$lashes$,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'express-neck-head';

INSERT INTO "Course"
  ("id", "slug", "title", "shortDescription", "fullDescription", "program",
   "duration", "categoryId", "status", "priceKZT", "priceRUB", "sortOrder", "updatedAt")
SELECT
  'hair_' || md5(random()::text || clock_timestamp()::text),
  'express-hair-spa',
  'Экспресс-массаж ШВЗ и кожи головы',
  'SPA-модуль для парикмахеров, колористов и мастеров по реконструкции волос.',
  $hair$Для парикмахеров, колористов и мастеров по реконструкции волос.

Как превратить обычный поход в салон в настоящую SPA-процедуру.

Это обучение поможет легко и гармонично встраивать расслабляющие техники в процесс окрашивания, ухода или мытья головы, повышая комфорт клиента без необходимости выделять отдельный визит.

Что входит в программу модуля:
• Экспресс-массаж шейно-воротниковой зоны (ШВЗ): бережная проработка трапеции, плеч и затылочной зоны с учётом положения клиента — пока выдерживается состав (краска, маска или средство для реконструкции волос), если это совместимо с процедурой.
• Расслабляющий массаж кожи головы: мягкие точечные и релаксирующие приёмы перед началом процедуры или непосредственно во время мытья головы в кресле у мойки, если это допускают применяемые средства.
• Правила работы и комфорт: лёгкие нежирные текстуры, гигиена, противопоказания и создание атмосферы SPA в кресле мастера.
• Продажа и позиционирование услуги: как предложить массаж в качестве комплимента или отдельной опции «VIP-SPA уход».

Результат: Вы научитесь дополнять салонный сервис расслабляющим SPA-уходом и сможете предложить клиенту дополнительную услугу.$hair$,
  'ШВЗ, массаж кожи головы, гигиена, противопоказания и VIP-SPA сервис',
  'Онлайн-обучение',
  category."id",
  'ACTIVE',
  3000,
  700,
  10,
  CURRENT_TIMESTAMP
FROM "CourseCategory" category
WHERE category."slug" = 'beauty'
ON CONFLICT ("slug") DO UPDATE
SET "title" = EXCLUDED."title",
    "shortDescription" = EXCLUDED."shortDescription",
    "fullDescription" = EXCLUDED."fullDescription",
    "status" = 'ACTIVE',
    "updatedAt" = CURRENT_TIMESTAMP;

INSERT INTO "CourseTariff"
  ("id", "courseId", "code", "titleRu", "titleKz", "priceKZT",
   "priceRUB", "sortOrder", "active", "updatedAt")
SELECT
  'hair_tariff_' || md5(random()::text || clock_timestamp()::text),
  course."id",
  'STANDARD',
  'Стандарт',
  'Стандарт',
  3000,
  700,
  10,
  true,
  CURRENT_TIMESTAMP
FROM "Course" course
WHERE course."slug" = 'express-hair-spa'
ON CONFLICT ("courseId", "code") DO NOTHING;

COMMIT;
