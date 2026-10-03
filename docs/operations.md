# Эксплуатация и API

## Prisma models

Обязательные: AdminUser, User, CourseCategory, Course, RecommendationRule, CourseRecommendation, Payment, Enrollment, ManagerRequest, FunnelEvent, QuestionnaireAnswer, Reminder, Setting, AuditLog, TelegramBotError.

Дополнительные: AdminSession (персистентные сессии), LoginAttempt (лимит входов), OutboxJob (доставка и доступ), TelegramUpdate (inbox), WorkerLease (единственный обработчик).

Начальная миграция: `20261003110000_initial`. Финансовые значения — Decimal(12,2). Telegram IDs — BigInt, в JSON сериализуются строками. Даты — UTC ISO; интерфейс отображает время браузера.

## HTTP API

- `GET /api/health`: проверка PostgreSQL без секретов, 200/503.
- `POST /api/auth/login`: `{email,password}`; HttpOnly cookie на 12 часов.
- `POST /api/auth/logout`: удалить session.
- `GET /api/admin/{resource}`: требует session и роль.
- `POST /api/admin/{resource}`: `{id?,data}`; создание или изменение.
- `DELETE /api/admin/{resource}`: `{id}`; курсы архивируются, направления отключаются, правила удаляются.
- `POST /api/admin/actions`: `{action,id?,revision?,reason?,reconciled?}`.
- `GET /api/admin/receipts/{paymentId}`: скачивание чека после входа.
- `POST /api/telegram/webhook`: только secret-token header, update хранится в БД.

Resources: dashboard, clients, courses, categories, recommendations, payments, access, requests, funnel, settings, admins, audit, jobs, lookups. Collections возвращают `{items,total,page}` по 25 строк; `q`, `status`, `page` применяются по смыслу раздела. Payments дополнительно поддерживает `currency`, `courseId`, `date`. `clients?id=...` возвращает карточку и timeline; `payments?id=...` — чек, Enrollment и audit.

Actions: `approve` / `reject` требуют текущий `receiptRevision` в `revision`; `retry` повторяет выдачу доступа; `telegram-test` проверяет getMe; `job-retry` повторяет FAILED outbox; `update-retry` сбрасывает attempts для inbox update. Все actions доступны только ADMIN. Requests и Clients можно редактировать MANAGER; write-critical resources запрещены на сервере независимо от интерфейса.

Все запросы изменения должны иметь `Origin`, совпадающий с `APP_URL`. При HTTP локально используйте `npm run dev` либо localhost preview; production login использует Secure cookie.

## Поддержка

- Проблема чека: отклонить Payment, клиент отправляет новый file_id; номер ревизии увеличивается, прошлый audit сохраняется.
- Ошибка доступа: исправить права/Channel ID в курсе, затем «Повторить выдачу».
- `UNCERTAIN`: проверить список приглашений Telegram, отозвать возможное приглашение с именем enrollment, затем подтвердить сверку. Срок операции до перевода зависшего CREATING в UNCERTAIN — 5 минут.
- Истекла ссылка: повторить выдачу; известная старая ссылка будет отозвана перед новой.
- Failed уведомления: раздел «Уведомления», фильтр FAILED, Повторить. Записанные приглашения не пересоздаются при повторной доставке ACCESS_NOTIFY.
- Inbox failures: Настройки показывают количество ошибок; после устранения причины ADMIN вызывает action `update-retry` с ID update. SQL `SELECT id, "lastError" FROM "TelegramUpdate" WHERE "processedAt" IS NULL AND attempts >= 5;` помогает диагностике.
- Платёж PAID нельзя откатить обычным повтором/отклонением. Возвраты требуют отдельной операционной процедуры; в этой версии нет автоматической банковской операции refund.

Ошибки хранятся в TelegramBotError, детали денежных изменений — в AuditLog и FunnelEvent. Секреты не отображаются; URLs с токеном редактируются логгером. Не передавайте сырые ошибки пользователю.

## Границы доставки

Payment/Enrollment идемпотентны за счёт unique constraints и serializable transactions. Telegram сообщения могут повторяться при неоднозначном завершении HTTP. Telegram invitation API не обладает exactly-once semantics; состояние UNCERTAIN требует сверки. Ограничение `member_limit=1` не доказывает личность посетителя по ссылке. Приватные сообщения принимаются для пользовательского потока; в группах доступны служебный `/id` и проверенные действия ADMIN.

Для webhook payload установлен предел 50 KB; сам файл передаётся через Telegram, в update хранится file_id. В админке file скачивается как attachment/octet-stream, чтобы не исполнять содержимое документа. Необязательный телефон принимается только при совпадении `contact.user_id` с отправителем.
