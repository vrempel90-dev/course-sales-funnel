-- New salon SPA course; existing course cards and tariffs remain unchanged.
INSERT INTO "Course" ("id","slug","title","categoryId","shortDescription","fullDescription","program","duration","priceKZT","priceRUB","status","sortOrder","createdAt","updatedAt")
SELECT 'course_hair_spa_20261008', 'express-hair-spa', $name$Экспресс-массаж ШВЗ и кожи головы$name$, "id", $short$СПА-дополнение для парикмахеров: массаж ШВЗ и кожи головы.$short$, $full$Для парикмахеров и мастеров по уходу за волосами.

Пока выдерживается состав или перед началом процедуры, предложите клиенту экспресс-массаж шейно-воротниковой зоны (ШВЗ), а до начала процедуры или во время мытья головы — расслабляющий массаж кожи головы. Это превращает обычный поход в салон в настоящую СПА-процедуру.

Что входит:
• Короткий мягкий массаж ШВЗ для расслабления плеч и шеи без сильного давления.
• Расслабляющий массаж кожи головы до процедуры или во время мытья головы, когда это совместимо с используемыми средствами.
• Гигиена, противопоказания и согласование массажа с этапами окрашивания и ухода за волосами.
• Как предложить услугу клиенту: комплимент от мастера или отдельный VIP-уход.

Результат: Вы сможете дополнить парикмахерские услуги комфортным СПА-ритуалом и предложить клиентам дополнительную ценность.$full$, 'Программа курса представлена в карточке.', 'Онлайн-обучение', 3000, 700, 'ACTIVE', 9, NOW(), NOW()
FROM "CourseCategory" WHERE "slug" = 'beauty'
ON CONFLICT ("slug") DO UPDATE SET "title"=EXCLUDED."title", "shortDescription"=EXCLUDED."shortDescription", "fullDescription"=EXCLUDED."fullDescription";

INSERT INTO "CourseTariff" ("id","courseId","code","titleRu","titleKz","priceKZT","priceRUB","active","sortOrder","createdAt","updatedAt")
SELECT 'tariff_hair_spa_20261008', "id", 'STANDARD', 'Стандарт', 'Стандарт', 3000, 700, true, 10, NOW(), NOW()
FROM "Course" WHERE "slug"='express-hair-spa'
ON CONFLICT ("courseId","code") DO NOTHING;
