# Course Sales Funnel

Telegram-бот продажи обучения и административная web-панель. Данные, анкета, оплаты, роли, история и фоновые задания хранятся в PostgreSQL. Оплату **вручную подтверждает ADMIN** после проверки чека. Банковской, Instagram или Meta интеграции нет.

## Архитектура

- Next.js 16 / React / TypeScript: админка и Route Handlers.
- Tailwind CSS 4 и компоненты shadcn/ui: интерфейс управления.
- grammY: Telegram Bot API, меню и обработчики сообщений.
- Prisma 6 / PostgreSQL: транзакции, ограничения уникальности, персистентное состояние.
- Отдельный worker: получение и обработка Telegram updates, outbox уведомлений, выдача доступа и напоминания.
- Zod: серверная проверка входных данных.

```
prisma/
  schema.prisma, seed.ts, migrations/
src/
  app/                 страницы и HTTP API
  components/          административный интерфейс, ui/
  admin/               разрешения, запросы и изменения
  bot/                 commands/, callbacks/, conversations/, keyboards/
  services/            анкета, рекомендации, платежи, доступ, jobs
  database/            PrismaClient
  lib/                 auth, пароли, конфигурация и обработка ошибок
  worker.ts
scripts/               запуск, настройка команд, интеграционные проверки
tests/                 unit и PostgreSQL + Telegram mocks
```

Web и worker запускаются вместе командой `npm start`. Сбой одного процесса завершает контейнер для перезапуска Railway. Worker lease в БД препятствует запуску двух активных обработчиков. Webhook сначала записывает update в PostgreSQL, после чего отвечает Telegram. Polling записывает updates и offset одной транзакцией. Незавершённые updates остаются в inbox. После 5 неудач update требуется повторить вручную через API; число ошибок видно в настройках.

Критические изменения выполняются serializable-транзакциями с ограниченным повтором при конфликте. Один активный платёж допускается на пару клиент/курс; переключение страны отменяет ещё не отправленный платёж и фиксирует новый снимок цены. Одно Enrollment — на клиент/курс и на Payment. Чек хранится как Telegram `file_id`; старая кнопка проверки не может подтвердить новую версию чека.

Подтверждение оплаты и создание Enrollment/outbox атомарны. Запрос Telegram выполняется после commit. Сбой выдачи доступа не отменяет PAID. Уведомления повторяются независимо от создания приглашения.

Telegram не предоставляет ключ идемпотентности для `createChatInviteLink`. Поэтому неопределённый таймаут или прерывание процесса переводит доступ в `UNCERTAIN`: ADMIN сверяет приглашения в канале, отзывает возможную незаписанную ссылку и подтверждает сверку при повторной выдаче. Автоматическое создание ещё одной ссылки в этом состоянии запрещено. Обычная ошибка 400/403 получает `FAILED` и кнопку повтора.

Outbox обеспечивает доставку с повторными попытками, а не exactly-once отправку сообщений: сбой после успешной отправки, но до записи результата может привести к повторному уведомлению. Все денежные изменения при этом идемпотентны.

## Локальный запуск

Требуются Node.js 22+, npm и PostgreSQL 16+.

```sh
npm ci
cp .env.example .env
docker compose up -d db
npm run db:generate
npm run db:migrate
npm run db:seed
npm run dev
```

В другом терминале запустите `npm run dev:worker`. Админка: `http://localhost:3000/admin`. Проверка БД: `GET /api/health` (503 при недоступной БД). Поле `telegram: configured` означает наличие токена, соединение проверяется отдельно в Настройках.

Без Docker создайте обычную БД PostgreSQL и укажите её URL. Для изменения схемы в разработке: `npm run db:dev -- --name descriptive_name`. Для production всегда используйте `npm run db:migrate`, а не `db push`.

Для проверки готовой сборки: `npm run build`, затем `npm start`. Для изолированной браузерной проверки можно использовать `npx tsx scripts/preview.ts`: создаётся отдельный PostgreSQL и тестовый ADMIN; credentials находятся в игнорируемом `work/preview-credentials.json`. Это не production database и не демонстрационная CRM.

## ENV

| Переменная                  | Назначение                                                                 |
| --------------------------- | -------------------------------------------------------------------------- |
| `DATABASE_URL`              | PostgreSQL connection URL                                                  |
| `TELEGRAM_BOT_TOKEN`        | Токен BotFather; без него worker отключён                                  |
| `TELEGRAM_BOT_USERNAME`     | Username для информации в настройках                                       |
| `TELEGRAM_ADMIN_CHAT_ID`    | Запасной чат уведомлений; настройка `bot.adminChatId` в БД имеет приоритет |
| `TELEGRAM_MODE`             | `polling` локально; `webhook` в production                                 |
| `TELEGRAM_WEBHOOK_SECRET`   | Случайный секрет минимум 32 символа для webhook; символы A–Z/a–z/0–9/_/-   |
| `APP_URL`                   | Точный origin приложения; для webhook необходим HTTPS                      |
| `ADMIN_INITIAL_EMAIL`       | Email первого администратора                                               |
| `ADMIN_INITIAL_PASSWORD`    | Уникальный пароль минимум 12 символов для первоначального seed             |
| `ADMIN_INITIAL_NAME`        | Имя первого администратора                                                 |
| `ADMIN_INITIAL_TELEGRAM_ID` | Необязательный числовой ID для подтверждения оплат в Telegram              |
| `SESSION_SECRET`            | Случайный секрет минимум 32 символа; смена инвалидирует сессии             |
| `INVITE_TTL_HOURS`          | Срок приглашения, 1–168 часов, по умолчанию 24                             |
| `WORKER_INTERVAL_MS`        | Интервал worker, минимум 250 ms, по умолчанию 1000                         |
| `NODE_ENV`                  | `development` локально / `production` на Railway                           |
| `PORT`                      | Порт web, Railway задаёт автоматически                                     |

Генерация секрета: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Секреты задаются в `.env` или Railway Variables; `.env` игнорируется Git. Не передавайте токен в URL админки. API скачивания чека проксирует Telegram-файл после проверки сессии; токен не отправляется в браузер.

## Первый ADMIN и роли

Заполните `ADMIN_INITIAL_EMAIL`, `ADMIN_INITIAL_PASSWORD`, `SESSION_SECRET` и выполните `npm run db:seed`. Seed не сбрасывает существующий пароль и не перезаписывает настройки. После создания первого ADMIN можно убрать initial password из production variables.

В разделе «Сотрудники» ADMIN создаёт дополнительные учётные записи и назначает Telegram ID. Чат уведомлений сам по себе не предоставляет право подтверждения: Telegram sender должен совпадать с активным ADMIN в БД. MANAGER может читать клиентов/курсы/платежи и менять карточки клиентов/запросы. Проверка платежей, цены, настройки, доступы и роли доступны только ADMIN. Пароли хэшируются scrypt; сессии хранятся в БД в хэшированном виде, истекают через 12 часов. Mutations проверяют origin; cookie HttpOnly, SameSite=Lax, Secure в production. Вход ограничен пятью попытками на email за 15 минут, с сохранением лимита в БД.

## Telegram / BotFather / каналы

1. Откройте [@BotFather](https://t.me/BotFather), отправьте `/newbot`, задайте имя и username.
2. Скопируйте token в `TELEGRAM_BOT_TOKEN`, username — в `TELEGRAM_BOT_USERNAME`.
3. Выполните `npm run bot:configure`: устанавливаются команды `/start`, `/menu`, `/id`.
4. Откройте личный чат с ботом, отправьте `/start`, затем `/id`. Полученный Telegram ID назначьте ADMIN через «Сотрудники» или `ADMIN_INITIAL_TELEGRAM_ID` при первом seed.
5. Для уведомлений используйте личный чат после `/start` либо группу, куда добавлен бот. Отправьте `/id` в группе для Chat ID, задайте `bot.adminChatId` в Настройках.
6. Создайте закрытый канал обучения и добавьте бота администратором. Дайте право приглашать пользователей (`can_invite_users`). Бот должен быть администратором для создания/отзыва приглашений и получения `chat_member` updates. Права публиковать или удалять сообщения для текущего сценария не нужны.
7. Узнайте ID канала, например переслав его сообщение боту, либо через официальный `getUpdates` в polling mode. Найдите `channel_post.chat.id` или `message.forward_origin.chat.id`; ID закрытого канала обычно начинается с `-100`. Worker текущего проекта запрашивает только message/callback_query/chat_member, поэтому для ручного чтения `getUpdates` остановите worker и временно удалите webhook. Не запускайте одновременно две polling-сессии. Безопаснее переслать сообщение в личный чат бота: для ADMIN будет показан исходный Channel ID.
8. Запишите числовой ID в `Course.telegramChannelId`. Для каждого курса может использоваться свой канал.

Доступ выдаётся отдельным приглашением `member_limit=1` с ограниченным сроком. Это лимит участников, а не привязка к личности покупателя: не пересылайте ссылки. При истечении срока ADMIN может повторить выдачу; если пользователь уже вступил и был получен `chat_member` update, «Мои курсы» открывает канал напрямую. Полученные события вступления записываются в Enrollment.

Справка: [Telegram Bot API](https://core.telegram.org/bots/api#createchatinvitelink), [grammY deployments](https://grammy.dev/guide/deployment-types).

## Настройка продаж

1. Seed создаёт 5 примерных направлений, 5 **DRAFT** курсов и правила; эти данные можно редактировать. Они не публикуются автоматически.
2. В «Направлениях» создайте нужные категории, настройте порядок и включение.
3. В «Курсах» заполните описания, программу, длительность, цены KZT и RUB, изображение URL, demo URL либо Telegram video `file_id`, Channel ID. Переведите готовый курс в ACTIVE. HIDDEN/ARCHIVED не показываются в каталоге; архивирование не стирает покупки.
4. В «Рекомендациях» задайте критерии и приоритет: ALL требует совпадения всех заданных полей, ANY — любого; null означает отсутствие ограничения. При отсутствии совпадений показываются активные курсы выбранного направления. Приоритеты разрешают порядок и выбор до пяти уникальных программ.
5. В «Настройках» отдельно заполните способы KZ/RU: название, инструкцию и реквизиты, затем включите. Seed содержит пустые реквизиты и выключенные способы. Бот фиксирует снимок суммы/реквизитов в Payment; редактирование курса не меняет уже созданный платёж.
6. При необходимости включите напоминания и задайте интервалы. Не более одного напоминания на тип/клиента/контекст; продолжение сценария отменяет неактуальные напоминания. Ошибки отправки ограничены пятью попытками.

## Railway

1. Создайте Railway project, добавьте PostgreSQL и подключите этот GitHub repository как сервис.
2. Railway использует `Dockerfile` и `railway.json`. Build: `npm run build`; pre-deploy migration: `npm run db:migrate`; start: `npm start`; healthcheck: `/api/health`.
3. Задайте `DATABASE_URL=${{Postgres.DATABASE_URL}}` (имя Postgres сервиса уточните в своём проекте), `NODE_ENV=production`, `SESSION_SECRET`, token/username/admin chat и первоначального ADMIN.
4. Создайте публичный Railway domain. Задайте `APP_URL=https://your-domain` без лишнего path, `TELEGRAM_MODE=webhook` и `TELEGRAM_WEBHOOK_SECRET`.
5. Deploy применяет миграцию. Однократно выполните `npm run db:seed` через Railway SSH/CLI в окружении сервиса, затем `npm run bot:configure`. Не выполняйте seed автоматически на каждом deploy.
6. Worker вызывает `setWebhook` с secret token. В webhook route проверяется заголовок `X-Telegram-Bot-Api-Secret-Token`. Updates сохраняются перед HTTP 200; при недоступной БД Telegram получает ошибку для повторной доставки.
7. Проверьте health, login и Telegram соединение из Настроек. Настройте категории, курсы, реквизиты и каналы.

Для этой версии используйте **одну replica** сервиса. Lease защищает от краткого пересечения перезапусков; горизонтальное масштабирование требует отдельного worker сервиса и настроенной стратегии replica lifecycle. Хранение чеков осуществляется Telegram, не filesystem Railway. Настройте резервное копирование PostgreSQL через Railway. Реальный deploy в рамках разработки требует доступа к вашему Railway project и заполненных variables.

## Проверка полного сценария

`/start` → Начать подбор → опыт → категория → цель → рекомендации → Подробнее → Демо → Купить → KZ/RU → увидеть сумму и реквизиты → Я оплатил → отправить фото/PDF → получить подтверждение получения чека.

В админке проверьте новую карточку клиента, ответы, events и Payment PENDING_REVIEW. Убедитесь, что ADMIN получил чек в Telegram. Сравните чек с фактическим поступлением денег в банке. Нажмите Подтвердить в Telegram либо web: Payment PAID, Enrollment ACTIVE. Повторное нажатие не создаёт Enrollment ещё раз. Пользователь получает приглашение и видит курс в «Мои курсы».

Повторите отдельно: RUB вместо KZT, отклонение с причиной и повторный чек, «Задать вопрос», перезапуск посреди анкеты, отсутствие прав бота в канале (PAID сохраняется, ошибка видна в «Доступах»), исправление прав и повтор, истечение ссылки, MANAGER без доступа к критическим mutations. Выручка по KZT/RUB отображается отдельно.

## Проверки и ограничения внешней верификации

```sh
npm run test                 # unit; PostgreSQL tests skipped without TEST_DATABASE_URL
npm run test:integration     # isolated real PostgreSQL, migrations, seed twice, unit + services + grammY mocks
npm run lint
npm run typecheck
npm run build
npm run test:http            # production HTTP API, auth/roles/CRUD/webhook; requires build
```

Интеграционные тесты запускают настоящую отдельную PostgreSQL instance через dev dependency `embedded-postgres`. Они не используют `DATABASE_URL` production и не очищают пользовательскую БД. Test data находится в игнорируемом `work/`. Telegram mock используется только в tests.

Без реального Bot Token невозможно проверить доставку через Telegram, права на канал, фактическое создание/отзыв приглашений, webhook registration и загрузку реальных чеков. Без банковской интеграции программа не определяет фактический приход денег: ответственность за проверку несёт администратор. Наличие сборки/тестов не означает выполненный Railway deploy.

API справка, модель данных и эксплуатационные детали: [docs/operations.md](docs/operations.md).
