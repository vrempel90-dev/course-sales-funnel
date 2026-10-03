# Проверка реализации

Проверки выполнены 3 октября 2026 года локально на Windows, Node.js 24.12.0. GitHub CI настроен на Node.js 22 / Ubuntu.

| Проверка | Результат |
| --- | --- |
| Начальная Prisma migration | Применена к отдельному PostgreSQL 16 |
| Seed два раза | Успешно; 5 DRAFT курсов и один initial ADMIN без дублей |
| `npm run test:integration` | 38 tests; 2 test files |
| `npm run lint` | 0 ошибок, 0 предупреждений |
| `npm run typecheck` | Prisma generate и TypeScript без ошибок |
| `npm run build` | Next.js production build и отдельный worker compilation |
| `npm run test:http` | 44 checks на production HTTP server |
| Browser QA | Вход, таблицы, создание направления, изменение длительности курса и сохранение |
| `npm audit --omit=dev` | 0 vulnerabilities |

Сервисы проверялись на настоящем изолированном PostgreSQL, Telegram API заменён mocks. HTTP smoke поднимает production Next server, проверяет auth/cookie, все разделы, origin check, roles, CRUD, payment approve/repeat, protected receipt API, webhook authentication и дедупликацию updates. Браузерные изменения выполнялись в отдельной preview-БД, не в production.

Покрыты: создание клиента, персистентная анкета и возврат назад, старые кнопки, рекомендации, выбор курса, KZT/RUB суммы, смена страны, чек и повторный чек, конкурентные approvals, уникальность Enrollment и invite, отказ Telegram с сохранением PAID, неоднозначный timeout, повтор доставки без пересоздания invite, manager request/message, роли, контакт и отмена напоминаний.

Не проверены без реальных credentials: Telegram delivery, реальный file download, права бота в каналах, create/revoke invite, webhook registration и Railway deploy. Payment проверяет ADMIN вручную; банковской API integration нет.

Полный `npm audit` сообщает о 5 high записях в dev toolchain ESLint/fast-glob/micromatch/braces. Опубликованного исправления braces для этой версии на момент проверки нет; production dependency audit чист. Не выполнялся принудительный downgrade framework. Prisma 6 предупреждает о будущем удалении package.json#prisma в следующем major — текущие generate/migrate/seed работают.
